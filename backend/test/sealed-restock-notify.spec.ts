import { Logger } from '@nestjs/common';
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

function build(
  opts: { flag?: string; pending?: any[]; available?: any[]; prices?: Record<string, number>; locked?: boolean; orphans?: any[] } = {},
) {
  const updates: { where: any; data: any }[] = [];
  const calls: string[] = [];
  // Una sola `$queryRaw` para las dos transacciones: el candado (`pg_try_advisory_xact_lock`) y la reconciliación (g) v1.87.4,
  // que devuelve `opts.orphans` (huérfanas con su `n = |D|` y `pid`). El ciclo real de (g) lo mide WSH-T44 (integración).
  const $queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    if (strings.join('?').includes('pg_try_advisory_xact_lock')) return [{ locked: opts.locked ?? true }];
    calls.push('reconcile');
    return opts.orphans ?? [];
  });
  const prisma: any = {
    sealedRestockSubscription: {
      findMany: jest.fn(async (a: any) => {
        calls.push(a?.select ? 'stay' : 'pending');
        return a?.select ? [] : (opts.pending ?? []);
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      updateMany: jest.fn(async (a: any) => {
        updates.push(a);
        return { count: Array.isArray(a.where.id?.in) ? a.where.id.in.length : 1 };
      }),
    },
    inventoryItem: { findMany: jest.fn(async () => opts.available ?? []) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    $queryRaw,
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
  return { prisma, settings, mail, svc, updates, calls };
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

  it('REL-S7-UX (4): sin origen público, la ruta escrita nombra la pestaña REAL «Producto sellado» / «Sealed product»', async () => {
    // La pestaña de la tienda es `storeTabs.sealed` (frontend/messages/es.json «Producto sellado», en.json «Sealed product»);
    // «Sellado»/«Sealed» a secas mandaba al cliente a buscar una pestaña que no existe.
    delete process.env.APP_PUBLIC_URL;
    const { svc, mail } = build({ flag: 'on', pending: [sub(ready)], available: [piece({})], prices: { i1: 1000 } });
    await svc.run();
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    const ruta = 'Búscalo en TCG HUNT › Comprar › Producto sellado. · Look for it at TCG HUNT › Shop › Sealed product.';
    expect(msg.text).toContain(ruta);
    expect(msg.html).toContain('Búscalo en TCG HUNT › Comprar › Producto sellado.');
    expect(msg.text).not.toMatch(/› Sellado\.|› Sealed\./);
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

  it('(g) v1.87.4: la reconciliación corre ANTES de leer las pendientes; huérfana con destino único ⇒ re-apunta y desarma', async () => {
    const orphan = { id: 's9', email: 'a@b.com', cardId: 'c1', sealedSubtype: 'box', sealedCondition: 'mint', createdAt: NOW, n: 1, pid: 100 };
    const { svc, calls, updates } = build({ flag: 'on', pending: [], orphans: [orphan] });
    await svc.run();
    expect(calls).toEqual(['reconcile', 'stay', 'pending']);
    expect(updates[0]).toEqual({
      where: { id: { in: ['s9'] }, notifiedAt: null },
      data: { tcgplayerProductId: 100, armedAt: null, matchedAt: null },
    });
  });

  it('(g) v1.87.4: huérfanas ambiguas (|D| = 0 o ≥ 2) ⇒ ni se re-apuntan ni se borran', async () => {
    const o = (id: string, n: number) => ({ id, email: 'a@b.com', cardId: 'c1', sealedSubtype: 'box', sealedCondition: 'mint', createdAt: NOW, n, pid: null });
    const { svc, prisma, updates } = build({ flag: 'on', pending: [], orphans: [o('s1', 0), o('s2', 2)] });
    await svc.run();
    expect(updates).toEqual([]);
    expect(prisma.sealedRestockSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('dial OFF ⇒ tampoco reconcilia (el job es no-op)', async () => {
    const { svc, calls } = build({ flag: 'off', orphans: [{ id: 's9', n: 1, pid: 1 }] });
    await svc.run();
    expect(calls).toEqual([]);
  });

  it('QA-1 (§84.cierre): la reconciliación solo deja línea de log si alguna de sus tres cifras ≠ 0', async () => {
    const reconLines = (spy: jest.SpyInstance) =>
      spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('reconciliación de mapeo'));
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      // Tick vacío: 0 re-apuntadas, 0 borradas, 0 intactas ⇒ sin línea.
      await build({ flag: 'on', pending: [], orphans: [] }).svc.run();
      expect(reconLines(spy)).toEqual([]);
      // Solo intactas (≠ 0) ⇒ sí hay línea, con sus cifras.
      const o = { id: 's1', email: 'a@b.com', cardId: 'c1', sealedSubtype: 'box', sealedCondition: 'mint', createdAt: NOW, n: 2, pid: null };
      await build({ flag: 'on', pending: [], orphans: [o] }).svc.run();
      expect(reconLines(spy)).toEqual([expect.stringContaining('0 re-apuntadas, 0 borradas por choque, 1 huérfanas intactas')]);
      spy.mockClear();
      // Solo re-apuntadas (≠ 0) ⇒ también.
      await build({ flag: 'on', pending: [], orphans: [{ ...o, n: 1, pid: 100 }] }).svc.run();
      expect(reconLines(spy)).toEqual([expect.stringContaining('1 re-apuntadas, 0 borradas por choque, 0 huérfanas intactas')]);
    } finally {
      spy.mockRestore();
    }
  });

  it('sin suscripciones pendientes → notified 0 (no consulta inventario)', async () => {
    const { svc, prisma } = build({ flag: 'on', pending: [] });
    expect((await svc.run()).notified).toBe(0);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});

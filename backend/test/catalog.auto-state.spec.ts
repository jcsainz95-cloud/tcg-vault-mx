import { CatalogAutoStateService } from '../src/modules/catalog/catalog-auto-state.service';
import { CatalogContentKeyBackfillService } from '../src/modules/catalog/catalog-content-key-backfill.service';
import { CatalogStaleAlertService } from '../src/modules/catalog/catalog-stale-alert.service';
import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';

/** Prisma falso con ConfigSetting persistente: otra instancia de servicio sobre el MISMO `db` = reinicio simulado. */
function fakeDb(cards: { externalId: string; setId: string; contentKey: string | null }[], sets: { id: string; externalId: string }[]) {
  const cfg = new Map<string, unknown>();
  const owners = [{ id: 'o1', isOwner: true, role: 'super_admin', email: 'dueno@example.com', status: 'active', deletedAt: null, name: 'D', nameSource: null, locale: 'es' }];
  const prisma: any = {
    configSetting: {
      findUnique: jest.fn(async ({ where }: any) => (cfg.has(where.key) ? { key: where.key, valueJson: cfg.get(where.key) } : null)),
      upsert: jest.fn(async ({ where, create, update }: any) => { cfg.set(where.key, (cfg.has(where.key) ? update : create).valueJson); }),
    },
    cardSet: { findMany: jest.fn(async () => sets) },
    card: {
      count: jest.fn(async ({ where }: any) => cards.filter((c) => c.setId === where.setId && c.contentKey === null).length),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = cards.find((x) => x.externalId === where.externalId && x.setId === where.setId);
        if (!c || c.contentKey === data.contentKey) return { count: 0 };
        c.contentKey = data.contentKey;
        return { count: 1 };
      }),
    },
    user: { findMany: jest.fn(async () => owners) },
  };
  return { prisma, cfg, owners };
}
const remote = (id: string, name: string) => ({ id, name, supertype: 'Pokémon', hp: '100', attacks: [{ name: 'Tackle' }], abilities: [] });

describe('AUTO: lastSuccessAt persistido', () => {
  it('sobrevive a un reinicio simulado (instancia nueva sobre la misma base)', async () => {
    const { prisma } = fakeDb([], []);
    const s1 = new CatalogAutoStateService(prisma);
    await s1.setLastSuccessAt('2026-11-09T01:00:00.000Z');
    const s2 = new CatalogAutoStateService(prisma);
    expect(await s2.getLastSuccessAt()).toBe('2026-11-09T01:00:00.000Z');
    // y CatalogSyncService la rehidrata al arrancar
    const sync = Object.create(CatalogSyncService.prototype) as any;
    sync.syncAllStatus = { lastSuccessAt: null };
    sync.autoState = s2;
    sync.logger = { warn: jest.fn() };
    await sync.onModuleInit();
    expect(sync.syncAllStatus.lastSuccessAt).toBe('2026-11-09T01:00:00.000Z');
  });
});

describe('AUTO-B: backfill de contentKey', () => {
  const mk = () => {
    const cards = [
      { externalId: 'a-1', setId: 'A', contentKey: null as string | null },
      { externalId: 'a-2', setId: 'A', contentKey: null as string | null },
      { externalId: 'b-1', setId: 'B', contentKey: null as string | null },
    ];
    const db = fakeDb(cards, [{ id: 'A', externalId: 'a' }, { id: 'B', externalId: 'b' }, ]);
    const client: any = {
      getCardsBySet: jest.fn(async (ext: string) => ({
        data: ext === 'a' ? [remote('a-1', 'Alpha'), remote('a-2', 'Beta')] : [remote('b-1', 'Gamma')],
        page: 1, pageSize: 250, count: 2, totalCount: ext === 'a' ? 2 : 1,
      })),
    };
    const links: any = { recompute: jest.fn(async () => ({ high: 0, low: 0, none: 0, changed: 0 })) };
    const state = new CatalogAutoStateService(db.prisma);
    return { cards, db, client, links, state, svc: new CatalogContentKeyBackfillService(db.prisma, client, state, links) };
  };

  it('calcula contentKey de lo existente, recalcula la liga y es idempotente (2a corrida: 0 pedidos, 0 cambios)', async () => {
    const { cards, client, links, svc } = mk();
    const r1 = await svc.run();
    expect(cards.every((c) => c.contentKey?.startsWith('pokemon|'))).toBe(true);
    expect(r1).toMatchObject({ setsDone: 2, cardsUpdated: 3, setsPending: 0, linksRecomputed: true });
    expect(links.recompute).toHaveBeenCalledTimes(1);
    const calls = client.getCardsBySet.mock.calls.length;
    const r2 = await svc.run();
    expect(r2).toMatchObject({ setsDone: 0, cardsUpdated: 0, setsPending: 0, linksRecomputed: false });
    expect(client.getCardsBySet.mock.calls.length).toBe(calls);
    expect(links.recompute).toHaveBeenCalledTimes(1);
  });

  it('reanudable: un set que falla queda pendiente y no frena al resto; otra instancia (reinicio) lo termina', async () => {
    const { cards, db, client, links, state, svc } = mk();
    client.getCardsBySet.mockImplementationOnce(async () => { throw new Error('HTTP 500'); });
    const r1 = await svc.run();
    expect(r1).toMatchObject({ setsDone: 1, setsPending: 1 });
    expect(cards.find((c) => c.setId === 'A')!.contentKey).toBeNull();
    expect(cards.find((c) => c.setId === 'B')!.contentKey).not.toBeNull();
    const svc2 = new CatalogContentKeyBackfillService(db.prisma, client, new CatalogAutoStateService(db.prisma), links);
    const r2 = await svc2.run();
    expect(r2).toMatchObject({ setsDone: 1, setsPending: 0, cardsUpdated: 2 });
    void state;
  });

  it('respeta el tope por corrida y no compite con un barrido en curso', async () => {
    const { client, svc } = mk();
    expect((await svc.run({ maxSets: 1 })).setsPending).toBe(1);
    const busy = mk();
    const r = await busy.svc.run({ isSyncRunning: () => true });
    expect(r.setsDone).toBe(0);
    expect(busy.client.getCardsBySet).not.toHaveBeenCalled();
    void client;
  });
});

describe('AUTO-S4: tope de reintentos del backfill por set', () => {
  it('un set que falla siempre se da por perdido tras 5 intentos y deja de pedirse; los demas siguen', async () => {
    const cards = [
      { externalId: 'a-1', setId: 'A', contentKey: null as string | null },
      { externalId: 'b-1', setId: 'B', contentKey: null as string | null },
    ];
    const db = fakeDb(cards, [{ id: 'A', externalId: 'a' }, { id: 'B', externalId: 'b' }]);
    const client: any = {
      getCardsBySet: jest.fn(async (ext: string) => {
        if (ext === 'a') throw new Error('HTTP 500');
        return { data: [remote('b-1', 'Gamma')], page: 1, pageSize: 250, count: 1, totalCount: 1 };
      }),
    };
    const state = new CatalogAutoStateService(db.prisma);
    const svc = new CatalogContentKeyBackfillService(db.prisma, client, state, undefined);
    for (let i = 0; i < 5; i++) await svc.run(); // literal: el tope documentado (AUTO-S4) son 5 intentos
    const callsA = () => client.getCardsBySet.mock.calls.filter((c: unknown[]) => c[0] === 'a').length;
    expect(callsA()).toBe(5);
    const r = await svc.run();
    expect(callsA()).toBe(5); // ya no se reintenta
    expect(r).toMatchObject({ setsPending: 0, setsAbandoned: 1 });
    expect(cards.find((c) => c.setId === 'B')!.contentKey).not.toBeNull();
    // ...pero NO es para siempre: pasadas 24 h se reintenta UNA vez (una caida larga del proveedor no lo condena).
    const later = Date.now() + 25 * 3_600_000;
    await svc.run({ now: () => later });
    expect(callsA()).toBe(6);
    await svc.run({ now: () => later + 1000 });
    expect(callsA()).toBe(6); // y otra vez fallo: de nuevo en espera 24 h
  });
});

describe('AUTO: alerta > 48 h sin exito del catalogo', () => {
  const H = 3_600_000;
  const mk = () => {
    const db = fakeDb([], []);
    const mail = { send: jest.fn(async () => ({})) };
    const state = new CatalogAutoStateService(db.prisma);
    const audit = { log: jest.fn(async () => undefined) };
    return { db, mail, state, svc: new CatalogStaleAlertService(db.prisma, state, mail as any, audit as any) };
  };
  const t0 = new Date('2026-11-01T00:00:00Z');

  it('no alerta antes de 48 h; alerta UNA vez pasado el umbral y no repite en pasadas siguientes', async () => {
    const { mail, state, svc } = mk();
    await state.setLastSuccessAt(t0.toISOString());
    expect(await svc.check(new Date(t0.getTime() + 47 * H))).toBe('fresh');
    expect(await svc.check(new Date(t0.getTime() + 49 * H))).toBe('sent');
    expect(await svc.check(new Date(t0.getTime() + 60 * H))).toBe('already_alerted');
    expect(await svc.check(new Date(t0.getTime() + 200 * H))).toBe('already_alerted');
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'dueno@example.com' }));
  });

  it('un nuevo exito abre la posibilidad de otro incidente', async () => {
    const { mail, state, svc } = mk();
    await state.setLastSuccessAt(t0.toISOString());
    await svc.check(new Date(t0.getTime() + 49 * H));
    const t1 = new Date(t0.getTime() + 100 * H);
    await state.setLastSuccessAt(t1.toISOString());
    expect(await svc.check(new Date(t1.getTime() + 10 * H))).toBe('fresh');
    expect(await svc.check(new Date(t1.getTime() + 49 * H))).toBe('sent');
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('sin exito previo la cuenta arranca al vigilar por primera vez (no alerta al desplegar) y luego alerta', async () => {
    const { mail, svc } = mk();
    expect(await svc.check(t0)).toBe('fresh');
    expect(await svc.check(new Date(t0.getTime() + 49 * H))).toBe('sent');
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('correo fallido o sin dueno NO marca el incidente (se reintenta, sin spam porque no salio nada)', async () => {
    const { mail, state, svc, db } = mk();
    await state.setLastSuccessAt(t0.toISOString());
    mail.send.mockRejectedValueOnce(new Error('resend down'));
    const late = new Date(t0.getTime() + 49 * H);
    expect(await svc.check(late)).toBe('mail_failed');
    expect(await svc.check(late)).toBe('sent');
    db.owners.length = 0;
    await state.setLastSuccessAt(late.toISOString());
    expect(await svc.check(new Date(late.getTime() + 49 * H))).toBe('no_recipient');
  });

  it('AUTO-S5 con 2 duenos y fallo a mitad del bucle, el reintento NO repite el correo al primero', async () => {
    const { mail, state, svc, db } = mk();
    db.owners.push({ ...db.owners[0], id: 'o2', email: 'socio@example.com' });
    await state.setLastSuccessAt(t0.toISOString());
    const late = new Date(t0.getTime() + 49 * H);
    mail.send.mockImplementationOnce(async () => ({})).mockRejectedValueOnce(new Error('resend down'));
    expect(await svc.check(late)).toBe('mail_failed');
    expect(await svc.check(late)).toBe('sent');
    const to = (mail.send.mock.calls as unknown as { to: string }[][]).map((c) => c[0].to);
    expect(to).toHaveLength(3); // 1.o (ok) + 2.o (falla) + 2.o (reintento): el 1.o NO se repite
    expect(to.filter((t) => t === 'dueno@example.com')).toHaveLength(1);
    expect(to.filter((t) => t === 'socio@example.com')).toHaveLength(2);
    expect(await svc.check(late)).toBe('already_alerted');
  });
});

import { SealedRestockNotifyService } from '../src/modules/catalog/sealed-restock-notify.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { MailPort } from '../src/modules/mail/mail.port';

/**
 * v1.23-sealed-sales (§4.23h(c)) — job `sealed-restock-notify`: feature-flagged (off → no-op), y con
 * el flag on empareja suscripciones PENDIENTES con productos sellados de vuelta a `listed` por
 * identidad de producto + condición, envía correo y marca `notifiedAt`.
 */
function build(opts: {
  flag?: string;
  pending?: any[];
  available?: any[];
} = {}) {
  const prisma = {
    sealedRestockSubscription: {
      findMany: jest.fn(async () => opts.pending ?? []),
      update: jest.fn(async () => ({})),
    },
    inventoryItem: { findMany: jest.fn(async () => opts.available ?? []) },
  } as unknown as PrismaService;
  const settings = {
    getString: jest.fn(async () => opts.flag ?? 'off'),
  } as unknown as SettingsService;
  const mail = { send: jest.fn(async () => ({ id: 'm1' })) } as unknown as MailPort;
  return { prisma, settings, mail, svc: new SealedRestockNotifyService(prisma, settings, mail) };
}

describe('SealedRestockNotifyService', () => {
  it('dial OFF → no-op (no consulta suscripciones, no envía)', async () => {
    const { svc, prisma, mail } = build({ flag: 'off' });
    const res = await svc.run();
    expect(res).toEqual({ job: 'sealed-restock-notify', enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' });
    expect((prisma.sealedRestockSubscription.findMany as jest.Mock)).not.toHaveBeenCalled();
    expect((mail.send as jest.Mock)).not.toHaveBeenCalled();
  });

  it('dial ON: notifica SOLO las suscripciones cuya identidad+condición está disponible', async () => {
    const pending = [
      // match: producto 100 mint disponible
      { id: 's1', email: 'a@b.com', tcgplayerProductId: 100, cardId: 'c1', sealedSubtype: 'box', sealedCondition: 'mint', card: { name: 'Box A' } },
      // no match: producto 100 minor_box_damage NO disponible
      { id: 's2', email: 'c@d.com', tcgplayerProductId: 100, cardId: 'c1', sealedSubtype: 'box', sealedCondition: 'minor_box_damage', card: { name: 'Box A' } },
      // match: no mapeado (cardId+subtype) mint disponible
      { id: 's3', email: 'e@f.com', tcgplayerProductId: null, cardId: 'c2', sealedSubtype: 'etb', sealedCondition: 'mint', card: { name: 'ETB B' } },
    ];
    const available = [
      { tcgplayerProductId: 100, cardId: 'c1', sealedSubtype: 'box', sealedCondition: 'mint' },
      { tcgplayerProductId: null, cardId: 'c2', sealedSubtype: 'etb', sealedCondition: 'mint' },
    ];
    const { svc, prisma, mail } = build({ flag: 'on', pending, available });
    const res = await svc.run();
    expect(res.enqueued).toBe(true);
    expect(res.notified).toBe(2);
    expect((mail.send as jest.Mock).mock.calls.map((c) => c[0].to).sort()).toEqual(['a@b.com', 'e@f.com']);
    const updatedIds = (prisma.sealedRestockSubscription.update as jest.Mock).mock.calls.map((c) => c[0].where.id).sort();
    expect(updatedIds).toEqual(['s1', 's3']);
    // La no-emparejada (s2) NO se marca ni se notifica.
    expect(updatedIds).not.toContain('s2');
  });

  it('sin suscripciones pendientes → notified 0 (no consulta inventario)', async () => {
    const { svc, prisma } = build({ flag: 'on', pending: [] });
    const res = await svc.run();
    expect(res.notified).toBe(0);
    expect((prisma.inventoryItem.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});

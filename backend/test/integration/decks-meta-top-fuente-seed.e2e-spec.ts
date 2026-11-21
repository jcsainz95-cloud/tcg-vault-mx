import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DecksMetaRefreshService } from '../../src/modules/decks-meta/decks-meta-refresh.service';
import { DIAL_AUTOPUBLISH } from '../../src/modules/decks-meta/limitless.config';
import type { DeckMatcherService } from '../../src/modules/decks-meta/deck-matcher.service';
import type { LimitlessFetchClient } from '../../src/modules/decks-meta/limitless-fetch.client';

/**
 * §DECKS-TOP-FUENTE.8 — seed del dial `decks_meta_autofetch_autopublish` contra Postgres REAL:
 * ausente ⇒ true; un `false` puesto a propósito NO se pisa; repetir es idempotente.
 */
describe('seed del dial de autopublicación (integración, Postgres real)', () => {
  const prisma = new PrismaService();
  const svc = new DecksMetaRefreshService(prisma, new ConfigService({}), {} as DeckMatcherService, {} as LimitlessFetchClient);
  const read = async () => (await prisma.configSetting.findUnique({ where: { key: DIAL_AUTOPUBLISH } }))?.valueJson;

  beforeAll(async () => { await prisma.$connect(); });
  beforeEach(async () => { await prisma.configSetting.deleteMany({ where: { key: DIAL_AUTOPUBLISH } }); });
  afterAll(async () => {
    await prisma.configSetting.deleteMany({ where: { key: DIAL_AUTOPUBLISH } });
    await prisma.$disconnect();
  });

  it('fila ausente ⇒ se siembra true', async () => {
    await svc.seedAutopublishDial();
    expect(await read()).toBe(true);
  });

  it('un false puesto a propósito NO se pisa (ni en 2 arranques seguidos)', async () => {
    await prisma.configSetting.create({ data: { key: DIAL_AUTOPUBLISH, valueJson: false, updatedBy: 'owner' } });
    await svc.seedAutopublishDial();
    await svc.seedAutopublishDial();
    expect(await read()).toBe(false);
    expect((await prisma.configSetting.findUnique({ where: { key: DIAL_AUTOPUBLISH } }))?.updatedBy).toBe('owner');
  });

  it('idempotente: repetir con true no duplica ni falla', async () => {
    await svc.seedAutopublishDial();
    await svc.seedAutopublishDial();
    expect(await prisma.configSetting.count({ where: { key: DIAL_AUTOPUBLISH } })).toBe(1);
  });
});

/**
 * MKT-V2 (m99) contra Postgres real: las dos tablas nuevas, el endpoint público `POST /marketing/search-miss`
 * (204 siempre, sin PII, incremento atómico, apagable), la retención de c6 (30/90) y el reclamo idempotente del correo del lunes.
 * Mutaciones que deben ponerlo rojo: guardar el término sin pasar por el filtro PII; `INSERT` sin `ON CONFLICT … count+1`; reclamar
 * el digest sin condicionar a `pending`/`claimedAt`.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { MarketingSearchMissService } from '../../src/modules/marketing/marketing-search-miss.service';
import { MarketingWeeklyDigestService } from '../../src/modules/marketing/marketing-weekly-digest.service';
import { MAIL_PORT } from '../../src/modules/mail/mail.port';

const RUN = randomBytes(3).toString('hex');

describe('MKT-V2 · m99 + search-miss + digest contra Postgres', () => {
  let h: E2EHarness;
  const sent: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create((b) => b.overrideProvider(MAIL_PORT).useValue({ send: async (m: { to: string }) => (sent.push(m.to), {}) }));
    await h.prisma.searchNoResultDaily.deleteMany({});
  });
  afterAll(async () => {
    await h.prisma.searchNoResultDaily.deleteMany({});
    await h.prisma.marketingWeeklyDigest.deleteMany({});
    await h.prisma.configSetting.deleteMany({ where: { key: { in: ['marketing_search_log', 'marketing_weekly_digest'] } } });
    await h.close();
  });

  it('m99 creó las dos tablas con su unicidad (término×día) y la PK por semana', async () => {
    const idx = await h.prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename IN ('SearchNoResultDaily','MarketingWeeklyDigest')`;
    const names = idx.map((i) => i.indexname);
    expect(names).toEqual(expect.arrayContaining(['SearchNoResultDaily_termNormalized_day_key', 'SearchNoResultDaily_termNormalized_idx', 'MarketingWeeklyDigest_pkey']));
  });

  it('POST /marketing/search-miss: 204 siempre; un término válido suma 1 (atómico con 10 simultáneos); la PII y el cuerpo inválido no escriben', async () => {
    const term = `umbreon vmax ${RUN}`;
    const post = (body: unknown) => h.api('POST', '/marketing/search-miss', { json: body });
    const res = await Promise.all(Array.from({ length: 10 }, () => post({ term, kind: 'card' })));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(204));
    for (const bad of [{ term: 'juan@correo.com', kind: 'card' }, { term: 'GOMC800101HDFRRR09', kind: 'card' }, { term: '5512345678', kind: 'sealed' }, { term: 'ok', kind: 'otro' }, { term: 'x'.repeat(200), kind: 'card' }, { nada: 1 }]) {
      expect((await post(bad)).status).toBe(204);
    }
    const rows = await h.prisma.searchNoResultDaily.findMany({});
    expect(rows.map((r) => [r.termNormalized, r.count])).toEqual([[term, 10]]);
  });

  it('flag marketing_search_log=off ⇒ 204 y no escribe', async () => {
    await h.prisma.configSetting.upsert({ where: { key: 'marketing_search_log' }, create: { key: 'marketing_search_log', valueJson: 'off' }, update: { valueJson: 'off' } });
    const before = await h.prisma.searchNoResultDaily.count();
    expect((await h.api('POST', '/marketing/search-miss', { json: { term: 'otra cosa rara', kind: 'card' } })).status).toBe(204);
    expect(await h.prisma.searchNoResultDaily.count()).toBe(before);
    await h.prisma.configSetting.delete({ where: { key: 'marketing_search_log' } });
  });

  it('retención: bajo el umbral 30 días, sobre el umbral 90', async () => {
    const svc = h.app.get(MarketingSearchMissService);
    await h.prisma.searchNoResultDaily.deleteMany({});
    const d = (n: number) => new Date(Date.now() - n * 86400_000);
    await h.prisma.searchNoResultDaily.createMany({
      data: [
        { termNormalized: 'poco', day: d(40), count: 1 }, // bajo umbral, > 30 d ⇒ borra
        { termNormalized: 'poco', day: d(2), count: 1 },
        { termNormalized: 'mucho', day: d(40), count: 4 }, // sobre umbral (4+2 en 2 días), ≤ 90 ⇒ se queda
        { termNormalized: 'mucho', day: d(3), count: 2 },
        { termNormalized: 'mucho', day: d(120), count: 9 }, // > 90 ⇒ borra
      ],
    });
    await svc.purgeExpired(new Date());
    const left = (await h.prisma.searchNoResultDaily.findMany({ orderBy: [{ termNormalized: 'asc' }, { day: 'asc' }] })).map((r) => [r.termNormalized, r.count]);
    expect(left).toEqual([['mucho', 4], ['mucho', 2], ['poco', 1]]);
  });

  it('digest: 2 ejecuciones simultáneas la misma semana ⇒ 1 envío; la fila queda sent', async () => {
    const sa = await h.prisma.user.findFirstOrThrow({ where: { role: 'super_admin', status: 'active' }, orderBy: { createdAt: 'asc' } });
    await h.prisma.user.updateMany({ where: { isOwner: true, id: { not: sa.id } }, data: { isOwner: false } });
    await h.prisma.user.update({ where: { id: sa.id }, data: { isOwner: true } });
    await h.prisma.marketingWeeklyDigest.deleteMany({});
    sent.length = 0;
    const svc = h.app.get(MarketingWeeklyDigestService);
    const monday = new Date('2026-11-09T15:00:00.000Z');
    const outs = await Promise.all([svc.run(monday), svc.run(monday), svc.run(monday)]);
    const kinds = outs.map((o) => o.outcome).sort();
    expect(kinds).toEqual(['noop', 'noop', 'sent']);
    const row = await h.prisma.marketingWeeklyDigest.findUniqueOrThrow({ where: { weekStart: new Date('2026-11-02T00:00:00.000Z') } });
    expect(row.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect((await svc.run(new Date(monday.getTime() + 3600_000))).outcome).toBe('noop');
  });
});

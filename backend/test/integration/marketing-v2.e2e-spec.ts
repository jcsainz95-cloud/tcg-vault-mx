/**
 * MKT-V2 (m99) contra Postgres real: las tres tablas nuevas, el endpoint público `POST /marketing/search-miss` (204 siempre, 413 sobre
 * 1 KB, sin PII, solo vocabulario del catálogo, PERSONAS por hash con sal diaria, topes 200/300, apagable), el cierre del día
 * (hashes → `people`, hashes y sal borrados), la retención de c6 (30/90) y el reclamo idempotente del correo por destinatario.
 * Mutaciones que deben ponerlo rojo: guardar el término sin filtro PII/vocabulario; contar peticiones en vez de hashes; no borrar los
 * hashes al cerrar; quitar los topes; reclamar el digest sin condicionar a `pending`/`claimedAt`.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { MarketingSearchMissService } from '../../src/modules/marketing/marketing-search-miss.service';
import { MarketingWeeklyDigestService, recipientKeyOf } from '../../src/modules/marketing/marketing-weekly-digest.service';
import { MAIL_PORT } from '../../src/modules/mail/mail.port';

const RUN = randomBytes(3).toString('hex');

describe('MKT-V2 · m99 + search-miss + digest contra Postgres', () => {
  let h: E2EHarness;
  const sent: string[] = [];
  const CARD_SET = `mkv2-set-${RUN}`;
  const WORD = `zzumbreon${RUN.replace(/\d/g, (c) => 'ghijklmnop'[Number(c)])}`; // solo letras: los dígitos del azar no deben rozar el filtro de PII
  const post = (body: unknown, ua = 'ua-a') => h.api('POST', '/marketing/search-miss', { json: body, headers: { 'user-agent': ua } });
  const seen = () => h.prisma.searchNoResultSeen.findMany({});

  beforeAll(async () => {
    h = await E2EHarness.create((b) => b.overrideProvider(MAIL_PORT).useValue({ send: async (m: { to: string }) => (sent.push(m.to), {}) }));
    await h.prisma.searchNoResultDaily.deleteMany({});
    await h.prisma.searchNoResultSeen.deleteMany({});
    await h.prisma.cardSet.create({ data: { id: CARD_SET, externalId: CARD_SET, name: 'MKV2 Set' } });
    await h.prisma.card.create({ data: { id: `${CARD_SET}-c`, externalId: `${CARD_SET}-c`, setId: CARD_SET, name: `${WORD} VMAX`, number: '215', rarity: 'Rare Holo', availableFinishes: ['normal'] } });
  });
  afterAll(async () => {
    await h.prisma.searchNoResultDaily.deleteMany({});
    await h.prisma.searchNoResultSeen.deleteMany({});
    await h.prisma.marketingWeeklyDigest.deleteMany({});
    await h.prisma.card.deleteMany({ where: { setId: CARD_SET } });
    await h.prisma.cardSet.deleteMany({ where: { id: CARD_SET } });
    await h.prisma.configSetting.deleteMany({ where: { OR: [{ key: { in: ['marketing_search_log', 'marketing_weekly_digest'] } }, { key: { startsWith: 'search_salt_' } }] } });
    await h.close();
  });

  it('m99 creó las tres tablas con su unicidad (término×día), la PK de hashes y la PK (semana×destinatario)', async () => {
    const idx = await h.prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename IN ('SearchNoResultDaily','SearchNoResultSeen','MarketingWeeklyDigest')`;
    expect(idx.map((i) => i.indexname)).toEqual(expect.arrayContaining(['SearchNoResultDaily_termNormalized_day_key', 'SearchNoResultDaily_termNormalized_idx', 'SearchNoResultSeen_pkey', 'MarketingWeeklyDigest_pkey']));
    const cols = await h.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'MarketingWeeklyDigest' AND table_schema = current_schema()`;
    expect(cols.map((c) => c.column_name)).toEqual(expect.arrayContaining(['weekStart', 'recipientKey', 'status', 'attempts']));
  });

  it('POST /marketing/search-miss: 204 siempre; 10 simultáneos del MISMO navegador = 1 persona; otro navegador = otra; PII, fuera de vocabulario y cuerpo inválido no escriben', async () => {
    const term = `${WORD} vmax`;
    const res = await Promise.all(Array.from({ length: 10 }, () => post({ term, kind: 'card' })));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(204));
    expect((await seen()).map((r) => r.termNormalized)).toEqual([term]);
    expect((await post({ term, kind: 'card' }, 'ua-b')).status).toBe(204);
    const rows = await seen();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.h)).size).toBe(2);
    for (const r of rows) expect(r.h).toMatch(/^[0-9a-f]{16}$/);
    const before = rows.length;
    const bad = [
      { term: 'juan@correo.com', kind: 'card' }, { term: 'GOMC800101HDFRRR09', kind: 'card' }, { term: 'gomc_800101_hdfrrr09', kind: 'card' },
      { term: '5512_3456', kind: 'sealed' }, { term: 'ok', kind: 'otro' }, { term: 'x'.repeat(200), kind: 'card' }, { nada: 1 },
      { term: 'maria lopez hernandez', kind: 'card' }, // nombre propio: fuera del vocabulario del catálogo
      { term: 'calle reforma 12', kind: 'card' },
    ];
    for (const b of bad) expect((await post(b)).status).toBe(204);
    expect((await h.api('POST', '/marketing/search-miss', { rawBody: '{"term": nope', headers: { 'content-type': 'application/json' } })).status).toBe(204);
    expect(await h.prisma.searchNoResultSeen.count()).toBe(before);
    // y nada de IP/UA en claro en ninguna tabla de c6
    expect(JSON.stringify(await h.prisma.searchNoResultSeen.findMany({}))).not.toMatch(/ua-a|ua-b|127\.0\.0\.1|::1/);
  });

  it('cuerpo > 1 KB ⇒ 413 limpio (sin 500, sin escribir); ≤ 1 KB sigue siendo 204', async () => {
    const before = await h.prisma.searchNoResultSeen.count();
    const big = await h.api('POST', '/marketing/search-miss', { json: { term: `${WORD} vmax`, kind: 'card', pad: 'x'.repeat(2000) } });
    expect(big.status).toBe(413);
    expect(await h.prisma.searchNoResultSeen.count()).toBe(before);
    expect((await post({ term: `${WORD} vmax`, kind: 'card' })).status).toBe(204);
  });

  it('flag marketing_search_log=off ⇒ 204 y no escribe', async () => {
    await h.prisma.configSetting.upsert({ where: { key: 'marketing_search_log' }, create: { key: 'marketing_search_log', valueJson: 'off' }, update: { valueJson: 'off' } });
    const before = await h.prisma.searchNoResultSeen.count();
    expect((await post({ term: `${WORD} 7`, kind: 'card' }, 'ua-z')).status).toBe(204);
    expect(await h.prisma.searchNoResultSeen.count()).toBe(before);
    await h.prisma.configSetting.delete({ where: { key: 'marketing_search_log' } });
  });

  it('50 peticiones del mismo IP/UA ⇒ 1 persona y no califica; topes: ≤ 200 hashes por término y ≤ 300 términos por día', async () => {
    const svc = h.app.get(MarketingSearchMissService);
    await h.prisma.searchNoResultSeen.deleteMany({});
    for (let i = 0; i < 50; i++) await svc.record(`${WORD} 1`, { ip: '198.51.100.1', userAgent: 'mismo' });
    expect(await h.prisma.searchNoResultSeen.count({ where: { termNormalized: `${WORD} 1` } })).toBe(1);
    for (let i = 0; i < 230; i++) await svc.record(`${WORD} 2`, { ip: `198.51.100.${i}`, userAgent: `ua${i}` });
    expect(await h.prisma.searchNoResultSeen.count({ where: { termNormalized: `${WORD} 2` } })).toBe(200);
    await h.prisma.searchNoResultSeen.deleteMany({});
    for (let i = 0; i < 305; i++) await svc.record(`${WORD} ${1000 + i}`, { ip: '203.0.113.9', userAgent: 'u' });
    const terms = await h.prisma.searchNoResultSeen.groupBy({ by: ['termNormalized'] });
    expect(terms).toHaveLength(300);
  });

  it('cierre del día: COUNT(h) → people, se borran hashes y sal de ese día; segunda corrida no hace nada; lectura por umbral de PERSONAS', async () => {
    const svc = h.app.get(MarketingSearchMissService);
    await h.prisma.searchNoResultSeen.deleteMany({});
    await h.prisma.searchNoResultDaily.deleteMany({});
    const day1 = new Date('2027-05-10T18:00:00.000Z');
    const day2 = new Date('2027-05-11T18:00:00.000Z');
    const term = `${WORD} 5`;
    for (let i = 0; i < 3; i++) await svc.record(term, { ip: `10.0.0.${i}`, userAgent: 'u' }, day1);
    expect(await h.prisma.configSetting.count({ where: { key: 'search_salt_2027-05-10' } })).toBe(1);
    // al escribir el día 11, el cierre PEREZOSO vuelca el día 10 (el job de las 00:10 no hizo falta)
    for (let i = 0; i < 2; i++) await svc.record(term, { ip: `10.0.1.${i}`, userAgent: 'u' }, day2);
    expect((await h.prisma.searchNoResultDaily.findMany({})).map((r) => [r.termNormalized, r.people])).toEqual([[term, 3]]);
    expect(await h.prisma.searchNoResultSeen.count()).toBe(2); // el día 11 sigue abierto
    expect(await h.prisma.configSetting.count({ where: { key: 'search_salt_2027-05-10' } })).toBe(0);
    expect(await h.prisma.configSetting.count({ where: { key: 'search_salt_2027-05-11' } })).toBe(1);
    expect(await svc.closePastDays(new Date('2027-05-12T06:10:00.000Z'))).toBe(1);
    expect(await svc.closePastDays(new Date('2027-05-12T06:11:00.000Z'))).toBe(0); // idempotente
    expect(await h.prisma.searchNoResultSeen.count()).toBe(0);
    expect(await h.prisma.configSetting.count({ where: { key: { startsWith: 'search_salt_2027' } } })).toBe(0);
    expect((await h.prisma.searchNoResultDaily.findMany({ orderBy: { day: 'asc' } })).map((r) => r.people)).toEqual([3, 2]);
    // 5 personas en 2 días con ≥ 2 cada uno ⇒ califica; con un solo día de 5 no
    expect(await svc.readQualifying('2027-05-10', '2027-05-16')).toEqual([{ term, people: 5, days: 2 }]);
    expect(await svc.readQualifying('2027-05-10', '2027-05-10')).toEqual([]);
    // fuera del vocabulario AL LEER (aunque haya volumen): se descarta
    await h.prisma.searchNoResultDaily.createMany({ data: [{ termNormalized: 'maria lopez', day: new Date('2027-05-10'), people: 9 }, { termNormalized: 'maria lopez', day: new Date('2027-05-11'), people: 9 }] });
    expect((await svc.readQualifying('2027-05-10', '2027-05-16'))!.map((r) => r.term)).toEqual([term]);
  });

  it('retención: bajo el umbral 30 días, sobre el umbral 90', async () => {
    const svc = h.app.get(MarketingSearchMissService);
    await h.prisma.searchNoResultDaily.deleteMany({});
    const d = (n: number) => new Date(Date.now() - n * 86400_000);
    await h.prisma.searchNoResultDaily.createMany({
      data: [
        { termNormalized: 'poco', day: d(40), people: 1 }, // bajo umbral, > 30 d ⇒ borra
        { termNormalized: 'poco', day: d(2), people: 1 },
        { termNormalized: 'mucho', day: d(40), people: 4 }, // sobre umbral (4+2 en 2 días ≥ 2), ≤ 90 ⇒ se queda
        { termNormalized: 'mucho', day: d(3), people: 2 },
        { termNormalized: 'mucho', day: d(120), people: 9 }, // > 90 ⇒ borra
      ],
    });
    await svc.purgeExpired(new Date());
    const left = (await h.prisma.searchNoResultDaily.findMany({ orderBy: [{ termNormalized: 'asc' }, { day: 'asc' }] })).map((r) => [r.termNormalized, r.people]);
    expect(left).toEqual([['mucho', 4], ['mucho', 2], ['poco', 1]]);
  });

  it('digest: 3 ejecuciones simultáneas la misma semana ⇒ 1 envío; la fila (semana × hash del destinatario) queda sent', async () => {
    const sa = await h.prisma.user.findFirstOrThrow({ where: { role: 'super_admin', status: 'active' }, orderBy: { createdAt: 'asc' } });
    await h.prisma.user.updateMany({ where: { isOwner: true, id: { not: sa.id } }, data: { isOwner: false } });
    await h.prisma.user.update({ where: { id: sa.id }, data: { isOwner: true } });
    await h.prisma.marketingWeeklyDigest.deleteMany({});
    sent.length = 0;
    const svc = h.app.get(MarketingWeeklyDigestService);
    const monday = new Date('2026-11-09T15:00:00.000Z');
    const outs = await Promise.all([svc.run(monday), svc.run(monday), svc.run(monday)]);
    expect(outs.map((o) => o.outcome).sort()).toEqual(['noop', 'noop', 'sent']);
    const rows = await h.prisma.marketingWeeklyDigest.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', weekStart: new Date('2026-11-02T00:00:00.000Z') });
    expect(rows[0].recipientKey).toBe(recipientKeyOf(sa.email!));
    expect(rows[0].recipientKey).not.toContain('@');
    expect(sent).toHaveLength(1);
    expect((await svc.run(new Date(monday.getTime() + 3600_000))).outcome).toBe('noop');
  });
});

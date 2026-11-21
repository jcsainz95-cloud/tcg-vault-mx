import { randomInt, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DecksMetaRefreshService } from '../../src/modules/decks-meta/decks-meta-refresh.service';
import { DIAL_AUTOFETCH, DIAL_AUTOPUBLISH } from '../../src/modules/decks-meta/limitless.config';
import type { DeckMatcherService } from '../../src/modules/decks-meta/deck-matcher.service';
import type { LimitlessFetchClient } from '../../src/modules/decks-meta/limitless-fetch.client';
import type { ParsedLine } from '../../src/modules/decks-meta/deck-list.parser';

/**
 * §DECKS-TOP-FUENTE.11-12 contra Postgres REAL: `missedRuns` (despublicación a 3 corridas válidas, rank=null al
 * salir del top, corridas fallidas/NO_PUBLISH no cuentan, pausado/manual intocables) y portada heredada sin pisar con null.
 */
const decklistHtml = readFileSync(join(__dirname, '..', 'fixtures', 'limitless', 'decklist-list.fixture.html'), 'utf8');

describe('decks-meta · missedRuns y portada heredada (integración, Postgres real)', () => {
  const prisma = new PrismaService();
  const tag = randomUUID().slice(0, 8);
  const base = randomInt(100_000_000, 800_000_000);
  const ids = { a: String(base + 1), b: String(base + 2), c: String(base + 3), man: String(base + 4), pau: String(base + 5) };
  const ref = (id: string) => `/decks/${id}`;
  const slugOf = (k: string) => `dtf-${tag}-${k}`;

  const idx = (rows: [number, string, string][]) =>
    `<html><table class="data-table">${rows.map(([r, id, n]) => `<tr><td>${r}</td><td></td><td><a href="/decks/${id}">${n}</a></td><td>9</td><td>10 %</td></tr>`).join('')}</table></html>`;
  const page = (listId: string) => `<html><table class="data-table"><tr><td><a href="/decks/list/${listId}">l</a></td></tr></table></html>`;

  const matcher = {
    matchLines: async (lines: ParsedLine[]) =>
      lines.map((l) =>
        l.isBasicEnergy || !l.setCode || !l.number
          ? { quantity: l.quantity, rawName: l.name, rawSetCode: '', rawNumber: '', group: 'energy', matchStatus: 'unmatched_basic_energy', matchedCard: null }
          : { quantity: l.quantity, rawName: l.name, rawSetCode: l.setCode, rawNumber: l.number, group: l.group, matchStatus: 'unmatched_set', matchedCard: null },
      ),
    matchCover: async () => ({ matchStatus: 'unmatched_set', card: null }),
  } as unknown as DeckMatcherService;

  function service(indexHtml: string | Error) {
    const client = {
      fetchDecksIndex: async () => { if (indexHtml instanceof Error) throw indexHtml; return indexHtml; },
      fetchArchetype: async (id: string) => page(`${id}0`),
      fetchDeckList: async () => decklistHtml,
      fetchHome: async () => { throw new Error('sin red'); },
    } as unknown as LimitlessFetchClient;
    // C3/C4 no son el objeto de esta prueba: umbrales laxos (las cartas se «casan» como unmatched_set).
    const cfg = new ConfigService({ META_FETCH_DELAY_MS: '0', META_CANARY_MIN_DECKS: '2', META_CANARY_MATCH_FLOOR: '0', META_CANARY_UNMATCHED_SET_MAX_RATIO: '1' });
    const svc = new DecksMetaRefreshService(prisma, cfg, matcher, client);
    jest.spyOn(svc as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    return svc;
  }
  const deck = (k: keyof typeof ids) => prisma.metaDeck.findFirstOrThrow({ where: { sourceRef: ref(ids[k]) } });
  const dials = (mode: string) =>
    Promise.all([
      prisma.configSetting.upsert({ where: { key: DIAL_AUTOFETCH }, create: { key: DIAL_AUTOFETCH, valueJson: mode, updatedBy: 't' }, update: { valueJson: mode } }),
      prisma.configSetting.upsert({ where: { key: DIAL_AUTOPUBLISH }, create: { key: DIAL_AUTOPUBLISH, valueJson: true, updatedBy: 't' }, update: { valueJson: true } }),
    ]);

  beforeAll(async () => {
    await prisma.$connect();
    await dials('on');
    // Decks pre-existentes de otra fuente: no se tocan (manual) / pausado (freno del operador).
    await prisma.metaDeck.create({ data: { slug: slugOf('man'), name: 'Manual', source: 'manual', sourceRef: ref(ids.man), rank: 9, published: true } });
    await prisma.metaDeck.create({ data: { slug: slugOf('pau'), name: 'Pausado', source: 'limitless', sourceRef: ref(ids.pau), rank: 8, published: true, pausedByOperator: true } });
  });
  afterAll(async () => {
    const decks = await prisma.metaDeck.findMany({ where: { sourceRef: { in: Object.values(ids).map(ref) } } });
    for (const d of decks) {
      await prisma.metaDeck.update({ where: { id: d.id }, data: { currentListId: null } });
      await prisma.metaDeckCard.deleteMany({ where: { list: { deckId: d.id } } });
      await prisma.metaDeckList.deleteMany({ where: { deckId: d.id } });
      await prisma.metaDeck.delete({ where: { id: d.id } });
    }
    await prisma.metaFetchRun.deleteMany({ where: { note: { contains: `dtf-${tag}` } } });
    await prisma.$disconnect();
  });

  const rowsABC: [number, string, string][] = [[1, ids.a, `dtf-${tag}-a`], [2, ids.b, `dtf-${tag}-b`], [3, ids.c, `dtf-${tag}-c`]];
  const rowsAB = rowsABC.slice(0, 2);

  it('corrida 0: los 3 entran publicados con su rank del índice y missedRuns=0', async () => {
    const r = await service(idx(rowsABC)).run({});
    expect(r).toMatchObject({ skipped: false, report: { verdict: 'PUBLISH', applied: true } });
    for (const [k, rank] of [['a', 1], ['b', 2], ['c', 3]] as const) {
      expect(await deck(k)).toMatchObject({ published: true, rank, missedRuns: 0 });
    }
  });

  it('corrida fallida (índice caído ⇒ NO_PUBLISH) y corrida con índice corto NO cuentan', async () => {
    await service(new Error('503')).run({});
    expect((await deck('c')).missedRuns).toBe(0);
    // índice con 1 fila (< minDecks=2) ⇒ C6/C1 fallan ⇒ NO_PUBLISH ⇒ nada se contabiliza
    await service(idx([[1, ids.a, `dtf-${tag}-a`]])).run({});
    expect(await deck('c')).toMatchObject({ missedRuns: 0, published: true, rank: 3 });
  });

  it('C ausente 1.ª y 2.ª corrida válidas: missedRuns 1 y 2, rank=null, SIGUE publicado', async () => {
    await service(idx(rowsAB)).run({});
    expect(await deck('c')).toMatchObject({ missedRuns: 1, rank: null, published: true });
    await service(idx(rowsAB)).run({});
    expect(await deck('c')).toMatchObject({ missedRuns: 2, rank: null, published: true });
    expect(await deck('a')).toMatchObject({ missedRuns: 0, rank: 1, published: true });
  });

  it('3.ª corrida válida ⇒ C se despublica y se reporta en delistedSlugs', async () => {
    const r = await service(idx(rowsAB)).run({});
    expect(r.skipped === false && r.report.delistedSlugs).toEqual([slugOf('c')]);
    expect(await deck('c')).toMatchObject({ missedRuns: 3, published: false, rank: null });
    expect(await deck('b')).toMatchObject({ published: true, rank: 2 });
  });

  it('manual y pausado quedan intactos durante todas las corridas', async () => {
    expect(await deck('man')).toMatchObject({ missedRuns: 0, rank: 9, published: true });
    expect(await deck('pau')).toMatchObject({ missedRuns: 0, rank: 8, published: true });
  });

  it('C reaparece ⇒ missedRuns=0, rank del índice y se vuelve a publicar (dial autopublish=true)', async () => {
    await service(idx(rowsABC)).run({});
    expect(await deck('c')).toMatchObject({ missedRuns: 0, rank: 3, published: true });
  });

  it('portada heredada: la lista vigente tiene SV6/25; la nueva (página sin img.card) la conserva', async () => {
    const d = await deck('a');
    const cur = await prisma.metaDeckList.update({
      where: { id: d.currentListId! },
      data: { coverSetCode: 'SV6', coverNumber: '25', coverMatchStatus: 'unmatched_number' },
    });
    expect(cur.coverSetCode).toBe('SV6');
    const idxChanged = idx(rowsABC);
    // misma lista pero nueva fila en BD: fuerza lista nueva cambiando el id de lista que sirve la página
    const client = {
      fetchDecksIndex: async () => idxChanged,
      fetchArchetype: async (id: string) => page(`${id}1`),
      fetchDeckList: async () => decklistHtml,
      fetchHome: async () => { throw new Error('sin red'); },
    } as unknown as LimitlessFetchClient;
    const cfg = new ConfigService({ META_FETCH_DELAY_MS: '0', META_CANARY_MIN_DECKS: '2', META_CANARY_MATCH_FLOOR: '0', META_CANARY_UNMATCHED_SET_MAX_RATIO: '1' });
    const svc = new DecksMetaRefreshService(prisma, cfg, matcher, client);
    jest.spyOn(svc as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    await svc.run({});
    const after = await deck('a');
    expect(after.currentListId).not.toBe(d.currentListId);
    const next = await prisma.metaDeckList.findUniqueOrThrow({ where: { id: after.currentListId! } });
    expect(next).toMatchObject({ coverSetCode: 'SV6', coverNumber: '25', coverMatchStatus: 'unmatched_number', coverCardId: null });
  });
});

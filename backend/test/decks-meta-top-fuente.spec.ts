import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeckMatcherService } from '../src/modules/decks-meta/deck-matcher.service';
import { LimitlessFetchClient } from '../src/modules/decks-meta/limitless-fetch.client';
import { DecksMetaRefreshService } from '../src/modules/decks-meta/decks-meta-refresh.service';
import { parseArchetypeFirstList, parseDecksIndex } from '../src/modules/decks-meta/limitless-html.parser';
import { evaluateCanary } from '../src/modules/decks-meta/canary';
import { CANARY_DEFAULTS, DIAL_AUTOFETCH, DIAL_AUTOPUBLISH } from '../src/modules/decks-meta/limitless.config';
import type { ParsedLine } from '../src/modules/decks-meta/deck-list.parser';

/**
 * §DECKS-TOP-FUENTE — candidatos desde `/decks` (HTML REAL guardado, 2026-11-21), 1+2N GET, fallback a la
 * portada, canario C6, publicación parcial. Sin red: `fetch` global se sustituye por un stub que sirve los
 * fixtures y CUENTA las GET físicas.
 */
const FX = join(__dirname, 'fixtures', 'limitless');
const indexHtml = readFileSync(join(FX, 'decks-index.html'), 'utf8');
const archetypeHtml = readFileSync(join(FX, 'archetype-page-284-2026-11.html'), 'utf8');
const homeHtml = readFileSync(join(FX, 'home-index.html'), 'utf8');
const decklistHtml = readFileSync(join(FX, 'decklist-list.fixture.html'), 'utf8');

const res = (status: number, body = '') => new Response(body, { status, headers: { 'content-type': 'text/html' } });

/** Stub de `fetch`: `/decks` → índice, `/decks/<id>` → página, `/decks/list/<id>` → lista, `/` → portada. */
function stubFetch(over: (url: string, n: number) => Response | null = () => null) {
  const urls: string[] = [];
  const impl = jest.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const o = over(url, urls.length);
    if (o) return o;
    const path = new URL(url).pathname;
    if (path === '/decks') return res(200, indexHtml);
    if (/^\/decks\/list\/\d+$/.test(path)) return res(200, decklistHtml);
    if (/^\/decks\/\d+$/.test(path)) return res(200, archetypeHtml);
    if (path === '/') return res(200, homeHtml);
    return res(404);
  });
  global.fetch = impl as unknown as typeof fetch;
  return urls;
}

function fakeMatcher(): DeckMatcherService {
  return {
    matchLines: jest.fn(async (lines: ParsedLine[]) =>
      lines.map((l) =>
        l.isBasicEnergy || !l.setCode || !l.number
          ? { quantity: l.quantity, rawName: l.name, rawSetCode: '', rawNumber: '', group: 'energy', matchStatus: 'unmatched_basic_energy', matchedCard: null }
          : { quantity: l.quantity, rawName: l.name, rawSetCode: l.setCode, rawNumber: l.number, group: l.group, matchStatus: 'matched', matchedCard: { id: `c-${l.setCode}-${l.number}` } },
      ),
    ),
    matchCover: jest.fn(async () => ({ matchStatus: 'unmatched_set', card: null })),
  } as unknown as DeckMatcherService;
}

function fakePrisma(autopublishRow?: boolean) {
  const decks = new Map<string, any>();
  const runs: any[] = [];
  const tx = {
    metaDeck: {
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async ({ where }: any) => decks.get(where.slug) ?? null),
      upsert: jest.fn(async ({ where, create }: any) => {
        const row = decks.get(where.slug) ?? { id: `deck-${where.slug}`, currentListId: null, ...create, slug: where.slug };
        decks.set(where.slug, row);
        return row;
      }),
      update: jest.fn(async () => ({})),
    },
    metaDeckList: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({ id: `l-${Math.random()}` })), update: jest.fn() },
  };
  const prisma = {
    configSetting: {
      findMany: jest.fn(async () => [
        { key: DIAL_AUTOFETCH, valueJson: 'on' },
        { key: DIAL_AUTOPUBLISH, valueJson: autopublishRow ?? true },
      ]),
    },
    metaFetchRun: { create: jest.fn(async ({ data }: any) => { runs.push(data); return {}; }) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, decks, runs };
}

function build(prisma: PrismaService, env: Record<string, string> = {}) {
  const config = new ConfigService({ META_FETCH_DELAY_MS: '0', META_FETCH_RETRIES: '0', ...env });
  const client = new LimitlessFetchClient(config);
  jest.spyOn(client as any, 'sleep').mockResolvedValue(undefined);
  const svc = new DecksMetaRefreshService(prisma, config, fakeMatcher(), client);
  jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
  return svc;
}

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

describe('parseDecksIndex / parseArchetypeFirstList (HTML real)', () => {
  it('el índice real trae 25 filas ordenadas, con id, nombre sin anotación y share', () => {
    const idx = parseDecksIndex(indexHtml);
    expect(idx.rows).toHaveLength(25);
    const ranks = idx.rows.map((r) => r.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks.every((r, i) => i === 0 || r >= ranks[i - 1])).toBe(true); // orden de rank (Limitless repite el puesto en empates)
    expect(idx.rows[0]).toEqual({ archetypeId: '284', rank: 1, name: 'Dragapult', sharePct: 36.46 });
    expect(idx.rows[2].name).toBe('Slowking'); // «Slowking <annotation>Seek Inspiration</annotation>»
    expect(idx.rows.every((r) => /^\d+$/.test(r.archetypeId) && r.sharePct != null)).toBe(true);
  });

  it('HTML sin tabla ⇒ 0 filas; la página de arquetipo da la PRIMERA lista y su torneo', () => {
    expect(parseDecksIndex('<html></html>').rows).toEqual([]);
    expect(parseArchetypeFirstList(archetypeHtml)).toEqual({
      listId: '29678',
      sourceTournament: expect.stringContaining('Special Event Buenos Aires'),
    });
    expect(parseArchetypeFirstList('<html></html>')).toBeNull();
  });
});

describe('canario C6', () => {
  const t = CANARY_DEFAULTS;
  const deck = { archetypeId: '1', slug: 'a', name: 'a', cardsParsed: 30, sumQuantity: 60, matched: 28, total: 30, unmatchedSet: 0 };
  it('con indexRows sustituye a C5; <minDecks ⇒ NO_PUBLISH', () => {
    const decks = Array.from({ length: 6 }, (_, i) => ({ ...deck, archetypeId: String(i) }));
    const ok = evaluateCanary({ homeParseable: false, leadersWithListId: 0, indexRows: 25, decks }, t);
    expect(ok.checks.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C6']);
    expect(ok.verdict).toBe('PUBLISH');
    const bad = evaluateCanary({ homeParseable: false, leadersWithListId: 0, indexRows: 5, decks }, t);
    expect(bad.verdict).toBe('NO_PUBLISH');
    expect(bad.checks.find((c) => c.id === 'C6')?.ok).toBe(false);
  });
});

describe('DecksMetaRefreshService con /decks', () => {
  it('20 candidatos ⇒ exactamente 1+2·20 = 41 GET, source=decks, 20 decks publicados', async () => {
    const urls = stubFetch();
    const { prisma, decks } = fakePrisma();
    const out = await build(prisma).run({});
    if (out.skipped) throw new Error('skipped');
    expect(urls).toHaveLength(41);
    expect(urls[0]).toBe('https://limitlesstcg.com/decks');
    expect(urls.filter((u) => /\/decks\/\d+$/.test(u))).toHaveLength(20);
    expect(urls.filter((u) => /\/decks\/list\/\d+$/.test(u))).toHaveLength(20);
    expect(out.report.source).toBe('decks');
    expect(out.report.verdict).toBe('PUBLISH');
    expect(out.report.persistedCount).toBe(20);
    expect(out.report.publishedSlugs).toHaveLength(20);
    expect(decks.size).toBe(20);
  });

  it('/decks falla ⇒ fallback a la portada (source=home-fallback) y sigue el camino de listas', async () => {
    const urls = stubFetch((u) => (new URL(u).pathname === '/decks' ? res(500) : null));
    const { prisma } = fakePrisma();
    const out = await build(prisma, { META_CANARY_MIN_DECKS: '3' }).run({ dryRun: true });
    if (out.skipped) throw new Error('skipped');
    expect(out.report.source).toBe('home-fallback');
    expect(out.report.errors.some((e) => e.startsWith('decks:'))).toBe(true);
    expect(urls[1]).toBe('https://limitlesstcg.com/');
    expect(urls.some((u) => /\/decks\/\d+$/.test(u))).toBe(false); // la portada ya trae el listId
    expect(out.report.decks.length).toBeGreaterThan(0);
    expect(out.report.canary.checks.map((c) => c.id)).toContain('C5');
  });

  it('presupuesto agotado (reintentos incluidos) ⇒ refresco parcial, jamás más de maxRequests GET, se publican los traídos', async () => {
    // Cada lista falla una vez con 503 y reintenta: cuesta 3 GET por deck. Tope 30 ⇒ 9 decks, no 14.
    let prev = '';
    const urls = stubFetch((u, n) => {
      const first = /\/decks\/list\/\d+$/.test(u) && prev !== u; // el fixture repite listId entre arquetipos: se falla el 1.er intento de cada visita
      prev = u;
      void n;
      return first ? res(503) : null;
    });
    const { prisma } = fakePrisma();
    const out = await build(prisma, { META_FETCH_MAX_REQUESTS: '30', META_FETCH_TOP_N: '14', META_FETCH_RETRIES: '2' }).run({});
    if (out.skipped) throw new Error('skipped');
    expect(urls.length).toBeLessThanOrEqual(30);
    expect(urls).toHaveLength(30);
    expect(out.report.persistedCount).toBeGreaterThanOrEqual(6);
    expect(out.report.persistedCount).toBeLessThan(14);
    expect(out.report.verdict).toBe('PUBLISH');
    expect(out.report.errors.some((e) => /presupuesto/.test(e))).toBe(true);
  });

  it('menos de 6 decks traídos ⇒ NO_PUBLISH (nada se persiste)', async () => {
    stubFetch();
    const { prisma, decks } = fakePrisma();
    const out = await build(prisma, { META_FETCH_MAX_REQUESTS: '11' }).run({}); // 1 + 2·5
    if (out.skipped) throw new Error('skipped');
    expect(out.report.verdict).toBe('NO_PUBLISH');
    expect(decks.size).toBe(0);
  });

  it('un deck sin lista en su página se salta sin abortar la corrida', async () => {
    stubFetch((u) => (new URL(u).pathname === '/decks/339' ? res(200, '<html></html>') : null));
    const { prisma, decks } = fakePrisma();
    const out = await build(prisma).run({});
    if (out.skipped) throw new Error('skipped');
    expect(out.report.persistedCount).toBe(19);
    expect(decks.has('basic-box')).toBe(false);
    expect(out.report.errors.some((e) => e.includes('339'))).toBe(true);
  });
});

describe('seed del dial decks_meta_autofetch_autopublish', () => {
  it('createMany con skipDuplicates y valor true (no upsert ⇒ no pisa nada)', async () => {
    const createMany = jest.fn(async () => ({ count: 1 }));
    const prisma = { configSetting: { createMany } } as unknown as PrismaService;
    await build(prisma).seedAutopublishDial();
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ key: DIAL_AUTOPUBLISH, valueJson: true })],
      skipDuplicates: true,
    });
  });
});

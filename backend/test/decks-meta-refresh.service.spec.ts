import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { DecksMetaService } from '../src/modules/decks-meta/decks-meta.service';
import { DeckMatcherService } from '../src/modules/decks-meta/deck-matcher.service';
import { LimitlessFetchClient } from '../src/modules/decks-meta/limitless-fetch.client';
import { DecksMetaRefreshService } from '../src/modules/decks-meta/decks-meta-refresh.service';
import { DIAL_AUTOFETCH, DIAL_AUTOPUBLISH } from '../src/modules/decks-meta/limitless.config';
import type { ParsedLine } from '../src/modules/decks-meta/deck-list.parser';

/**
 * DECKS-META Fase 2 — ORQUESTADOR (spec §4, §5, §6, §8). Egress BLOQUEADO: el cliente HTTP se MOCKEA
 * para devolver los fixtures; jamás hay red real. Cubre: diales (off/dryrun/on), dry-run no escribe
 * nada, manual gana, supersede-no-borra, pausedByOperator, y canary-fail conserva el último-bueno.
 */
const FIXTURES = join(__dirname, 'fixtures', 'limitless');
const homeHtml = readFileSync(join(FIXTURES, 'home-index.html'), 'utf8');
const decklistHtml = readFileSync(join(FIXTURES, 'decklist-list.fixture.html'), 'utf8');

// Matcher que casa TODO lo que tiene identidad y marca las básicas (ratio de match alto ⇒ canary OK).
function fakeMatcher(): DeckMatcherService {
  return {
    matchLines: jest.fn(async (lines: ParsedLine[]) =>
      lines.map((l) => {
        if (l.isBasicEnergy || !l.setCode || !l.number) {
          return { quantity: l.quantity, rawName: l.name, rawSetCode: '', rawNumber: '', group: 'energy', matchStatus: 'unmatched_basic_energy', matchedCard: null };
        }
        return {
          quantity: l.quantity,
          rawName: l.name,
          rawSetCode: l.setCode,
          rawNumber: l.number,
          group: l.group,
          matchStatus: 'matched',
          matchedCard: { id: `card-${l.setCode}-${l.number}`, regulationMark: 'H', legalStandardRaw: 'Legal', externalId: `${l.setCode}-${l.number}`, set: { id: 's', ptcgoCode: l.setCode } },
        };
      }),
    ),
  } as unknown as DeckMatcherService;
}

function fakeClient(): LimitlessFetchClient {
  return {
    fetchHome: jest.fn(async () => homeHtml),
    fetchDeckList: jest.fn(async () => decklistHtml),
    fetchArchetype: jest.fn(async () => ''),
  } as unknown as LimitlessFetchClient;
}

function fakeDeckMeta(): DecksMetaService {
  // SUP-LEG: el refresh ya no consulta legalidad al servicio; se inyecta vacío.
  return {} as unknown as DecksMetaService;
}

/** Prisma en memoria: diales + store de MetaDeck por slug + registro de escrituras. */
function fakePrisma(opts: {
  dial?: string;
  autopublish?: boolean;
  seedDecks?: { slug: string; id: string; source?: string; published?: boolean; pausedByOperator?: boolean; currentListId?: string | null; sharePct?: number }[];
}) {
  const decks = new Map<string, any>();
  for (const d of opts.seedDecks ?? []) {
    decks.set(d.slug, { source: 'limitless', published: false, pausedByOperator: false, currentListId: null, ...d });
  }
  const calls = {
    listCreate: [] as any[],
    listUpdate: [] as any[],
    listDelete: [] as any[],
    deckDelete: [] as any[],
    deckUpdate: [] as any[],
    fetchRun: [] as any[],
  };
  let listSeq = 0;

  const tx = {
    metaDeck: {
      findUnique: jest.fn(async ({ where }: any) => decks.get(where.slug) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = decks.get(where.slug);
        if (existing) {
          const merged = { ...existing, ...stripUndefined(update) };
          decks.set(where.slug, merged);
          return merged;
        }
        const row = { id: `deck-${where.slug}`, currentListId: null, ...create, slug: where.slug };
        decks.set(where.slug, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        calls.deckUpdate.push({ where, data });
        for (const [slug, row] of decks) if (row.id === where.id) decks.set(slug, { ...row, ...data });
        return {};
      }),
      delete: jest.fn(async (a: any) => { calls.deckDelete.push(a); }),
    },
    metaDeckList: {
      create: jest.fn(async ({ data }: any) => { const id = `list-${++listSeq}`; calls.listCreate.push({ id, data }); return { id }; }),
      update: jest.fn(async (a: any) => { calls.listUpdate.push(a); }),
      delete: jest.fn(async (a: any) => { calls.listDelete.push(a); }),
    },
  };

  const prisma = {
    configSetting: {
      findMany: jest.fn(async () => [
        { key: DIAL_AUTOFETCH, valueJson: opts.dial ?? 'off' },
        { key: DIAL_AUTOPUBLISH, valueJson: opts.autopublish ?? false },
      ]),
    },
    metaDeck: tx.metaDeck,
    metaDeckList: tx.metaDeckList,
    metaFetchRun: { create: jest.fn(async ({ data }: any) => { calls.fetchRun.push(data); return { id: 'run-1' }; }) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;

  return { prisma, calls, decks };
}

function stripUndefined(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

function build(prisma: PrismaService, envOver: Record<string, string> = {}) {
  const config = new ConfigService({ META_FETCH_DELAY_MS: '0', ...envOver });
  return new DecksMetaRefreshService(prisma, config, fakeDeckMeta(), fakeMatcher(), fakeClient());
}

describe('DecksMetaRefreshService (§4/§5/§6/§8)', () => {
  it('dial=off + sin dryRun ⇒ NO-OP: no fetch, no escritura, no MetaFetchRun', async () => {
    const { prisma, calls } = fakePrisma({ dial: 'off' });
    const client = fakeClient();
    const svc = new DecksMetaRefreshService(prisma, new ConfigService({ META_FETCH_DELAY_MS: '0' }), fakeDeckMeta(), fakeMatcher(), client);
    const r = await svc.run({});
    expect(r).toMatchObject({ skipped: true, reason: 'DIAL_OFF' });
    expect(client.fetchHome).not.toHaveBeenCalled();
    expect(calls.listCreate).toHaveLength(0);
    expect(calls.fetchRun).toHaveLength(0);
  });

  it('DRY-RUN (dial=off pero dryRun:true) ⇒ corre el pipeline REAL pero NO escribe NADA', async () => {
    const { prisma, calls } = fakePrisma({ dial: 'off' });
    const svc = build(prisma);
    const r = await svc.run({ dryRun: true });
    expect(r.skipped).toBe(false);
    if (r.skipped) return;
    expect(r.mode).toBe('dryrun');
    expect(r.report.verdict).toBe('PUBLISH'); // 6 decks a 60, match alto
    expect(r.report.wouldPublish).toBe(true);
    expect(r.report.decks).toHaveLength(6);
    expect(r.report.decks[0].sumQuantity).toBe(60);
    // NADA escrito: ni listas, ni supersede, ni currentListId, ni MetaFetchRun.
    expect(calls.listCreate).toHaveLength(0);
    expect(calls.listUpdate).toHaveLength(0);
    expect(calls.deckUpdate).toHaveLength(0);
    expect(calls.fetchRun).toHaveLength(0);
  });

  it('dial=on + canary PASA ⇒ persiste una MetaDeckList nueva por deck y registra MetaFetchRun{applied:true}', async () => {
    const { prisma, calls } = fakePrisma({ dial: 'on' });
    const svc = build(prisma);
    const r = await svc.run({});
    expect(r.skipped).toBe(false);
    if (r.skipped) return;
    expect(r.mode).toBe('live');
    expect(r.report.applied).toBe(true);
    expect(calls.listCreate).toHaveLength(6); // una lista nueva por arquetipo
    // Cada lista tiene 60 cartas por cantidad (las 60 líneas del fixture).
    const cards = calls.listCreate[0].data.cards.create;
    expect(cards.reduce((s: number, c: any) => s + c.quantity, 0)).toBe(60);
    expect(calls.fetchRun).toHaveLength(1);
    expect(calls.fetchRun[0]).toMatchObject({ applied: true, source: 'limitless', formatVersion: 'TEF-PBL' });
  });

  it('autopublish=false (default) ⇒ la lista se guarda pero published NO se enciende', async () => {
    const { prisma, calls } = fakePrisma({ dial: 'on', autopublish: false });
    const svc = build(prisma);
    const r = await svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    expect(calls.listCreate).toHaveLength(6);
    expect(r.report.publishedSlugs).toHaveLength(0); // conservador: operador flipa published
  });

  it('autopublish=true ⇒ los decks que pasan canary se publican', async () => {
    const { prisma } = fakePrisma({ dial: 'on', autopublish: true });
    const svc = build(prisma);
    const r = await svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    expect(r.report.publishedSlugs.length).toBe(6);
  });

  it('MANUAL GANA: un deck source=manual con el mismo slug NO se pisa (se registra conflicto)', async () => {
    // El slug de «Dragapult» es `dragapult`; lo sembramos como manual.
    const { prisma, calls } = fakePrisma({
      dial: 'on',
      seedDecks: [{ slug: 'dragapult', id: 'deck-manual', source: 'manual', published: true }],
    });
    const svc = build(prisma);
    const r = await svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    expect(r.report.manualConflicts).toContain('dragapult');
    // Se crean listas para los OTROS 5, no para el manual.
    expect(calls.listCreate).toHaveLength(5);
  });

  it('pausedByOperator ⇒ el deck se salta (ni lista nueva ni currentList)', async () => {
    const { prisma, calls } = fakePrisma({
      dial: 'on',
      seedDecks: [{ slug: 'dragapult', id: 'deck-paused', pausedByOperator: true }],
    });
    const svc = build(prisma);
    const r = await svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    expect(r.report.pausedSkipped).toContain('dragapult');
    expect(calls.listCreate).toHaveLength(5);
  });

  it('SUPERSEDE (no borra): un deck con currentListId previo marca la vieja supersededById y NUNCA la borra', async () => {
    const { prisma, calls } = fakePrisma({
      dial: 'on',
      seedDecks: [{ slug: 'dragapult', id: 'deck-1', source: 'limitless', currentListId: 'old-list', sharePct: 30 }],
    });
    const svc = build(prisma);
    const r = await svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    // La lista vieja se marca reemplazada, NO se borra.
    const superseded = calls.listUpdate.find((u) => u.where.id === 'old-list');
    expect(superseded).toBeDefined();
    expect(superseded.data.supersededById).toBeTruthy();
    expect(calls.listDelete).toHaveLength(0);
    expect(calls.deckDelete).toHaveLength(0);
    // Y el deck re-apunta su currentListId a la lista nueva.
    expect(calls.deckUpdate.some((u) => u.where.id === 'deck-1' && u.data.currentListId)).toBe(true);
    expect(r.report.supersededListIds).toContain('old-list');
  });

  it('CANARY FALLA (umbral env sube minDecks a 8; la home solo da 6) ⇒ NO publica, conserva último-bueno, MetaFetchRun{applied:false}', async () => {
    const { prisma, calls } = fakePrisma({ dial: 'on' });
    const svc = build(prisma, { META_CANARY_MIN_DECKS: '8' });
    const r = await svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    expect(r.report.verdict).toBe('NO_PUBLISH');
    expect(r.report.applied).toBe(false);
    expect(calls.listCreate).toHaveLength(0); // nada nuevo se publica
    expect(calls.listUpdate).toHaveLength(0); // no se re-apunta currentList
    expect(calls.fetchRun).toHaveLength(1);
    expect(calls.fetchRun[0]).toMatchObject({ applied: false });
  });

  it('single-flight: una segunda corrida concurrente se rechaza (ALREADY_RUNNING)', async () => {
    const { prisma } = fakePrisma({ dial: 'on' });
    const svc = build(prisma);
    const [a, b] = await Promise.all([svc.run({}), svc.run({})]);
    const outcomes = [a, b].map((x) => (x.skipped ? x.reason : 'ran'));
    expect(outcomes).toContain('ALREADY_RUNNING');
    expect(outcomes).toContain('ran');
  });
});

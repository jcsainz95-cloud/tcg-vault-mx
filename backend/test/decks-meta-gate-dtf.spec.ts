import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeckMatcherService } from '../src/modules/decks-meta/deck-matcher.service';
import { LimitlessFetchClient } from '../src/modules/decks-meta/limitless-fetch.client';
import { DecksMetaRefreshService, suffixSlug } from '../src/modules/decks-meta/decks-meta-refresh.service';
import { parseArchetypeCover, parseDecksIndex, parseArchetypeFirstList } from '../src/modules/decks-meta/limitless-html.parser';
import { evaluateCanary } from '../src/modules/decks-meta/canary';
import { CANARY_DEFAULTS, DIAL_AUTOFETCH, DIAL_AUTOPUBLISH, deckSlugFor, isValidLimitlessId } from '../src/modules/decks-meta/limitless.config';
import type { ParsedLine } from '../src/modules/decks-meta/deck-list.parser';

/**
 * §DECKS-TOP-FUENTE puntos 11, 13, 14, 15, 16 (cierre de gates qa/seguridad). Sin red ni BD: fakes en memoria.
 * (El punto 12, `missedRuns`, va contra Postgres real: test/integration/decks-meta-missed-runs.e2e-spec.ts.)
 */
const FX = join(__dirname, 'fixtures', 'limitless');
const archetypeHtml = readFileSync(join(FX, 'archetype-page-284-2026-11.html'), 'utf8');
const decklistHtml = readFileSync(join(FX, 'decklist-list.fixture.html'), 'utf8');

const indexOf = (rows: string[]) =>
  `<html><ul class="active-options"><li>Format: TEF-PBL</li></ul><table class="data-table">${rows.join('')}</table></html>`;
const rowOf = (rank: string | number, id: string, name: string, share = '10.5 %') =>
  `<tr><td>${rank}</td><td></td><td><a href="/decks/${id}">${name}</a></td><td>99</td><td>${share}</td></tr>`;
const pageOf = (listId: string, cover?: string) =>
  `<html>${cover ? `<div class="picture"><img class="card" src="x_XS.png" data-src="https://cdn/tpci/${cover}.png"></div>` : ''}` +
  `<table class="data-table"><tr><th class="sub-heading">Torneo X</th></tr><tr><td><a href="/decks/list/${listId}">l</a></td></tr></table></html>`;

describe('punto 11 · parseArchetypeCover (`.picture img.card`)', () => {
  it('fixture real: TWM_130 ⇒ {TWM,130}', () => {
    expect(parseArchetypeCover(archetypeHtml)).toEqual({ setCode: 'TWM', number: '130' });
  });
  it('sin `.picture`, sin img.card, o forma ajena ⇒ null', () => {
    expect(parseArchetypeCover('<html></html>')).toBeNull();
    expect(parseArchetypeCover('<div class="picture"><img src="a.png"></div>')).toBeNull();
    expect(parseArchetypeCover('<div class="picture"><img class="card" data-src="https://cdn/tpci/TWM/OTRO_130_R.png"></div>')).toBeNull();
    expect(parseArchetypeCover('<div class="picture"><img class="card" data-src="https://cdn/otro/TWM/TWM_130.png"></div>')).toBeNull();
  });
  it('acepta sets con guion (SV-P) y número alfanumérico', () => {
    expect(parseArchetypeCover(pageOf('1', 'SV-P/SV-P_12_R_EN'))).toEqual({ setCode: 'SV-P', number: '12' });
  });
});

describe('punto 14 · slug y topes del parser', () => {
  it('nombre sin ASCII ⇒ arch-<id>; NFKD resuelve anchura completa; nunca vacío', () => {
    expect(deckSlugFor('リザードン', '1234')).toBe('arch-1234');
    expect(deckSlugFor('', '7')).toBe('arch-7');
    expect(deckSlugFor(null, '7')).toBe('arch-7');
    expect(deckSlugFor('ＤＲＡＧＡＰＵＬＴ ｅｘ', '1')).toBe('dragapult-ex');
    expect(deckSlugFor('Gardevoir ﬁ', '1')).toBe('gardevoir-fi');
  });
  it('suffixSlug añade -<id> y respeta 120', () => {
    expect(suffixSlug('dragapult', '284')).toBe('dragapult-284');
    expect(suffixSlug('a'.repeat(200), '284')).toHaveLength(120);
    expect(suffixSlug('a'.repeat(200), '284').endsWith('-284')).toBe(true);
  });
  it('ids ≤ 10 dígitos', () => {
    expect(isValidLimitlessId('1234567890')).toBe(true);
    expect(isValidLimitlessId('12345678901')).toBe(false);
  });
  it('índice: nombre de 200 KB ⇒ ≤80 sin control/HTML; sharePct 9999999999 ⇒ null; id de 11 dígitos ⇒ fila descartada', () => {
    const big = `Dragapult\u0007${'x'.repeat(200_000)}`;
    const idx = parseDecksIndex(
      indexOf([rowOf(1, '10', big), rowOf(2, '11', 'Ok', '9999999999 %'), rowOf(3, '12345678901', 'Largo'), rowOf(4, '13', 'Neg', '-5 %'), rowOf(5, '14', '   ')]),
    );
    expect(idx.rows.map((r) => r.archetypeId)).toEqual(['10', '11', '13']);
    expect(idx.rows[0].name.length).toBeLessThanOrEqual(80);
    expect(idx.rows[0].name).not.toMatch(/[\u0000-\u001f]/);
    expect(idx.rows[1].sharePct).toBeNull();
    expect(idx.rows[2].sharePct).toBe(5); // el signo no entra en la captura; 0..100 ⇒ válido
  });
  it('sourceTournament ≤ 120', () => {
    const html = `<table class="data-table"><tr><th class="sub-heading">${'T'.repeat(5000)}</th></tr><tr><td><a href="/decks/list/5">l</a></td></tr></table>`;
    expect(parseArchetypeFirstList(html)?.sourceTournament?.length).toBe(120);
  });
});

describe('punto 16 · C2 = fuera de banda ≤ 40 % de las filas válidas', () => {
  const t = CANARY_DEFAULTS;
  const d = (i: number, sum = 60) => ({ archetypeId: String(i), slug: `d${i}`, name: `d${i}`, cardsParsed: 30, sumQuantity: sum, matched: 28, total: 30, unmatchedSet: 0 });
  const decks = (n: number) => Array.from({ length: n }, (_, i) => d(i));
  const c2 = (inBand: number, total: number) =>
    evaluateCanary({ homeParseable: false, leadersWithListId: 0, indexRows: 25, bandTotal: total, decks: decks(inBand) }, t).checks.find((c) => c.id === 'C2')!;
  it('4 de 10 fuera de banda (40 %) pasa; 5 de 10 no', () => {
    expect(c2(6, 10).ok).toBe(true);
    expect(c2(5, 10).ok).toBe(false);
    expect(evaluateCanary({ homeParseable: false, leadersWithListId: 0, indexRows: 25, bandTotal: 10, decks: decks(5) }, t).verdict).toBe('NO_PUBLISH');
  });
  it('sin filas válidas ⇒ falla; sin bandTotal (portada) sigue siendo estricto (0 fuera de banda)', () => {
    expect(c2(0, 0).ok).toBe(false);
    const strict = evaluateCanary({ homeParseable: true, leadersWithListId: 8, decks: [...decks(7), d(99, 30)] }, t);
    expect(strict.checks.find((c) => c.id === 'C2')?.ok).toBe(false);
  });
});

// ── pipeline con fakes ────────────────────────────────────────────────────────────────────────────

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

interface Prev { slug: string; sourceRef: string; cover?: { set: string; num: string; status: string; card: string | null } }

function fakePrisma(prevs: Prev[] = []) {
  const decks = new Map<string, any>();
  const lists = new Map<string, any>();
  for (const p of prevs) {
    const listId = `prev-${p.slug}`;
    lists.set(listId, {
      coverSetCode: p.cover?.set ?? null, coverNumber: p.cover?.num ?? null, coverMatchStatus: p.cover?.status ?? null, coverCardId: p.cover?.card ?? null,
    });
    decks.set(p.slug, { id: `deck-${p.slug}`, slug: p.slug, source: 'limitless', sourceRef: p.sourceRef, published: true, pausedByOperator: false, currentListId: listId, rank: 3, sharePct: 5 });
  }
  const created: any[] = [];
  const upserts: any[] = [];
  const tx = {
    metaDeck: {
      findFirst: jest.fn(async ({ where }: any) => [...decks.values()].find((d) => d.sourceRef === where.sourceRef) ?? null),
      findUnique: jest.fn(async ({ where }: any) => decks.get(where.slug) ?? null),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        upserts.push({ where, create, update });
        const row = decks.get(where.slug) ?? { id: `deck-${where.slug}`, currentListId: null, ...create, slug: where.slug };
        decks.set(where.slug, row);
        return row;
      }),
      update: jest.fn(async () => ({})),
    },
    metaDeckList: {
      findUnique: jest.fn(async ({ where }: any) => lists.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => { created.push(data); return { id: `l-${created.length}` }; }),
      update: jest.fn(),
    },
  };
  const prisma = {
    configSetting: { findMany: jest.fn(async () => [{ key: DIAL_AUTOFETCH, valueJson: 'on' }, { key: DIAL_AUTOPUBLISH, valueJson: true }]) },
    metaFetchRun: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, created, upserts, decks };
}

function fakeClient(rows: string[], pages: Record<string, string>): LimitlessFetchClient {
  return {
    fetchDecksIndex: jest.fn(async () => indexOf(rows)),
    fetchArchetype: jest.fn(async (id: string) => pages[id] ?? pageOf(`9${id}`)),
    fetchDeckList: jest.fn(async () => decklistHtml),
    fetchHome: jest.fn(async () => '<html></html>'),
  } as unknown as LimitlessFetchClient;
}

function build(prisma: PrismaService, client: LimitlessFetchClient) {
  const svc = new DecksMetaRefreshService(prisma, new ConfigService({ META_FETCH_DELAY_MS: '0', META_CANARY_MIN_DECKS: '2' }), fakeMatcher(), client);
  jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
  return svc;
}

describe('punto 11 · la portada nunca se pisa con null', () => {
  const rows = [rowOf(1, '501', 'Basic Box'), rowOf(2, '502', 'Festival Lead'), rowOf(3, '503', 'Otro')];

  it('página SIN img.card ⇒ la lista nueva hereda la portada vigente (basic-box conserva SV6/25, festival-lead su carta)', async () => {
    const { prisma, created } = fakePrisma([
      { slug: 'basic-box', sourceRef: '/decks/501', cover: { set: 'SV6', num: '25', status: 'unmatched_number', card: null } },
      { slug: 'festival-lead', sourceRef: '/decks/502', cover: { set: 'TWM', num: '25', status: 'matched', card: 'card-twm-25' } },
    ]);
    const svc = build(prisma, fakeClient(rows, {}));
    const r = await svc.run({});
    expect(r.skipped).toBe(false);
    const byList = created.map((c) => [c.coverSetCode, c.coverNumber, c.coverMatchStatus, c.coverCardId]);
    expect(byList[0]).toEqual(['SV6', '25', 'unmatched_number', null]);
    expect(byList[1]).toEqual(['TWM', '25', 'matched', 'card-twm-25']);
    expect(byList[2]).toEqual([null, null, null, null]); // deck nuevo sin previa ⇒ null (único caso permitido)
  });

  it('portada nueva que NO casa no pisa una vigente que sí casó; portada nueva casada sí reemplaza', async () => {
    const { prisma, created } = fakePrisma([
      { slug: 'basic-box', sourceRef: '/decks/501', cover: { set: 'TWM', num: '25', status: 'matched', card: 'card-twm-25' } },
      { slug: 'festival-lead', sourceRef: '/decks/502', cover: { set: 'TWM', num: '25', status: 'matched', card: 'card-twm-25' } },
    ]);
    const pages = { '501': pageOf('1', 'MEG/MEG_56_R_EN'), '502': pageOf('2', 'SCR/SCR_58_R_EN') };
    const matcher = fakeMatcher();
    (matcher.matchCover as jest.Mock).mockImplementation(async (c: { setCode: string }) =>
      c.setCode === 'SCR' ? { matchStatus: 'matched', card: { id: 'card-scr-58' } } : { matchStatus: 'unmatched_set', card: null });
    const svc = new DecksMetaRefreshService(prisma, new ConfigService({ META_FETCH_DELAY_MS: '0', META_CANARY_MIN_DECKS: '2' }), matcher, fakeClient(rows, pages));
    jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
    await svc.run({});
    expect(created[0].coverCardId).toBe('card-twm-25'); // MEG no casó: se conserva la vigente
    expect(created[1].coverCardId).toBe('card-scr-58');
  });

  it('con img.card en la página y casada, usa ESA portada (sin GET extra: el cliente no se llama más)', async () => {
    const { prisma, created } = fakePrisma();
    const client = fakeClient(rows, { '501': pageOf('1', 'TWM/TWM_130_R_EN') });
    const matcher = fakeMatcher();
    (matcher.matchCover as jest.Mock).mockResolvedValue({ matchStatus: 'matched', card: { id: 'card-twm-130' } });
    const svc = new DecksMetaRefreshService(prisma, new ConfigService({ META_FETCH_DELAY_MS: '0', META_CANARY_MIN_DECKS: '2' }), matcher, client);
    jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
    await svc.run({});
    expect(created[0]).toMatchObject({ coverSetCode: 'TWM', coverNumber: '130', coverMatchStatus: 'matched', coverCardId: 'card-twm-130' });
    expect(client.fetchArchetype).toHaveBeenCalledTimes(3);
  });
});

describe('punto 14 · slug en el pipeline', () => {
  it('nombre japonés ⇒ slug arch-<id>; dos arquetipos con el mismo nombre ⇒ el 2.º con sufijo -<id>', async () => {
    const { prisma, upserts } = fakePrisma();
    const svc = build(prisma, fakeClient([rowOf(1, '601', 'リザードン'), rowOf(2, '602', 'Mismo'), rowOf(3, '603', 'Mismo')], {}));
    const r = await svc.run({});
    expect(r.skipped).toBe(false);
    const slugs = upserts.map((u) => u.where.slug);
    expect(slugs).toEqual(['arch-601', 'mismo', 'mismo-603']);
    expect(slugs.every((s) => s.length > 0)).toBe(true);
  });

  it('colisión con OTRO arquetipo ya en BD ⇒ sufijo; el arquetipo que ya existe conserva su slug', async () => {
    const { prisma, upserts } = fakePrisma([{ slug: 'mismo', sourceRef: '/decks/999' }, { slug: 'viejo-nombre', sourceRef: '/decks/602' }]);
    const svc = build(prisma, fakeClient([rowOf(1, '601', 'Mismo'), rowOf(2, '602', 'Nombre Nuevo'), rowOf(3, '603', 'Otro')], {}));
    await svc.run({});
    expect(upserts.map((u) => u.where.slug)).toEqual(['mismo-601', 'viejo-nombre', 'otro']);
  });

  it('invariante: persistDeck rechaza slug vacío', async () => {
    const { prisma } = fakePrisma();
    const svc = build(prisma, fakeClient([], {}));
    await expect((svc as any).persistDeck({ slug: '', leader: { archetypeId: '1', rank: 1, name: 'x', sharePct: 1, listId: '1' }, matched: [], cover: null }, { formatLabel: 'S', sourceTournament: null }, true, 20))
      .rejects.toThrow(/slug vacío/);
  });
});

describe('punto 13 · rank null no publica; candidatos solo con rank 1..topN', () => {
  it('persistDeck con rank null ⇒ deck nuevo se crea published=false aunque autopublish=true', async () => {
    const { prisma, upserts } = fakePrisma();
    const svc = build(prisma, fakeClient([], {}));
    const p = { slug: 'sin-rank', leader: { archetypeId: '7', rank: null, name: 'Sin rank', sharePct: 3, listId: '70' }, matched: [], cover: null };
    const out = await (svc as any).persistDeck(p, { formatLabel: 'S', sourceTournament: null }, true, 20);
    expect(out.published).toBe(false);
    expect(upserts[0].create.published).toBe(false);
    expect(upserts[0].update.published).toBeUndefined();
  });

  it('el índice descarta rank no numérico/0/>topN y ordena por rank', async () => {
    const { prisma, upserts } = fakePrisma();
    const client = fakeClient([rowOf(3, '703', 'C'), rowOf('x', '799', 'Malo'), rowOf(0, '798', 'Cero'), rowOf(1, '701', 'A'), rowOf(2, '702', 'B'), rowOf(21, '721', 'Fuera')], {});
    const svc = build(prisma, client);
    await svc.run({});
    expect(upserts.map((u) => u.where.slug)).toEqual(['a', 'b', 'c']);
    expect(upserts.map((u) => u.create.rank)).toEqual([1, 2, 3]);
  });
});

describe('punto 15 · «Publicar ahora»: encolar, idempotente, estado', () => {
  it('encola ⇒ jobId; mientras corre, un 2.º enqueue devuelve el MISMO jobId (deduped); al acabar, uno nuevo', async () => {
    const { prisma } = fakePrisma();
    const svc = build(prisma, fakeClient([], {}));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    jest.spyOn(svc, 'run').mockImplementation(async () => { await gate; return { skipped: true, reason: 'DIAL_OFF', mode: 'off' }; });

    const a = svc.enqueue({ dryRun: true });
    expect(a).toMatchObject({ status: 'queued', deduped: false });
    expect(svc.getJob(a.jobId)?.status).toBe('queued');
    const b = svc.enqueue({});
    expect(b).toMatchObject({ jobId: a.jobId, deduped: true });

    await new Promise((r) => setImmediate(r));
    expect(svc.getJob(a.jobId)?.status).toBe('running');
    expect(svc.enqueue({}).jobId).toBe(a.jobId);

    release();
    await new Promise((r) => setTimeout(r, 5));
    const done = svc.getJob(a.jobId)!;
    expect(done.status).toBe('done');
    expect(done.result).toEqual({ skipped: true, reason: 'DIAL_OFF', mode: 'off' });
    expect(done.finishedAt).not.toBeNull();
    expect(svc.run).toHaveBeenCalledTimes(1);

    const c = svc.enqueue({});
    expect(c.jobId).not.toBe(a.jobId);
    expect(c.deduped).toBe(false);
  });

  it('si run lanza ⇒ status failed con error acotado; id desconocido ⇒ null', async () => {
    const { prisma } = fakePrisma();
    const svc = build(prisma, fakeClient([], {}));
    jest.spyOn(svc, 'run').mockRejectedValue(new Error('boom'));
    const a = svc.enqueue({});
    await new Promise((r) => setTimeout(r, 5));
    expect(svc.getJob(a.jobId)).toMatchObject({ status: 'failed', error: 'boom', result: null });
    expect(svc.getJob('no-existe')).toBeNull();
  });
});

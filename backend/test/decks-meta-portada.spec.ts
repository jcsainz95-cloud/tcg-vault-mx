import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { CoverMatchStatus, DeckMatcherService } from '../src/modules/decks-meta/deck-matcher.service';
import { LimitlessFetchClient } from '../src/modules/decks-meta/limitless-fetch.client';
import { DecksMetaRefreshService } from '../src/modules/decks-meta/decks-meta-refresh.service';
import { parseDeckListHtml, parseHomeIndex } from '../src/modules/decks-meta/limitless-html.parser';
import { DIAL_AUTOFETCH, DIAL_AUTOPUBLISH } from '../src/modules/decks-meta/limitless.config';

/**
 * rev `decks-portada` (API_CONTRACT §13 «Portada del deck», ARCHITECTURE §12.4) — P1–P6, C-1 (fila 4b) y TD-c.
 *
 * La portada que Limitless pinta en la home (`a.leader-image > img[alt="SET-NÚM"]`) se extrae (parser),
 * se casa con el MISMO motor que las 60 (matcher real, Prisma en memoria) y se guarda en la
 * `MetaDeckList` (modo vivo) / se reporta en `decks[].cover` (ensayo). Nunca bloquea ni cuenta: no
 * entra en `lines`, ni en el canario, ni en `MetaDeckCard`. Egress BLOQUEADO: fixtures offline.
 */
const FIXTURES = join(__dirname, 'fixtures', 'limitless');
const homeHtml = readFileSync(join(FIXTURES, 'home-index.html'), 'utf8');
const decklistHtml = readFileSync(join(FIXTURES, 'decklist-list.fixture.html'), 'utf8');
const homeSinPortada = homeHtml.replace(/ alt="[^"]*"/g, '');

// ── P1 / P2 — parser ──────────────────────────────────────────────────────────────────────────────

describe('P1 · parseHomeIndex extrae la portada del `alt` (fixture REAL)', () => {
  it('leaders[i].cover = TWM/130, TWM/25, MEG/56, JTG/98, SCR/58, PBL/65, en orden; número CRUDO (sin ceros)', () => {
    const { leaders } = parseHomeIndex(homeHtml);
    expect(leaders.map((l) => l.cover)).toEqual([
      { setCode: 'TWM', number: '130' },
      { setCode: 'TWM', number: '25' },
      { setCode: 'MEG', number: '56' },
      { setCode: 'JTG', number: '98' },
      { setCode: 'SCR', number: '58' },
      { setCode: 'PBL', number: '65' },
    ]);
  });
});

describe('P2 · `alt` inválido ⇒ cover:null y el RESTO del bloque intacto', () => {
  const block = (imgAttrs: string) =>
    [
      '<h2>Top Decks (TEF-PBL)</h2><div class="top-leaders"><div class="leader">',
      `<a class="leader-image" href="/decks/284"><img src="https://cdn/tpci/TWM/TWM_130_R_EN_SM.png"${imgAttrs}></a>`,
      '<a class="leader-details" href="/decks/284"><div class="text-lg font-bold mb-1">1. Dragapult</div><div>36.11%</div></a>',
      '<a class="leader-decklist" href="/decks/list/28760"><div class="text-sm mb-2">Featured Decklist</div><div>Worlds</div></a>',
      '</div></div>',
    ].join('');
  const rest = { archetypeId: '284', name: 'Dragapult', rank: 1, sharePct: 36.11, listId: '28760', sourceTournament: 'Worlds' };

  it('control: alt válido ⇒ cover poblada con el mismo resto', () => {
    expect(parseHomeIndex(block(' alt="TWM-130"')).leaders[0]).toEqual({ ...rest, cover: { setCode: 'TWM', number: '130' } });
  });

  it.each([
    ['ausente', ''],
    ['vacío', ' alt=""'],
    ['sin número', ' alt="TWM"'],
    ['guion final', ' alt="TWM-"'],
    ['markup', ' alt="<b>x</b>-1"'],
    ['30 chars (número largo)', ` alt="TWM-${'1'.repeat(26)}"`],
    ['30 chars (set largo)', ` alt="${'A'.repeat(28)}-1"`],
    ['espacio interno', ' alt="TW M-1"'],
    ['set terminado en guion', ' alt="TWM--25"'],
    ['set de solo guion final (SV-)', ' alt="SV--P"'],
  ])('alt %s ⇒ cover:null', (_label, attrs) => {
    expect(parseHomeIndex(block(attrs)).leaders[0]).toEqual({ ...rest, cover: null });
  });

  it('el set se separa por el ÚLTIMO guion y se hace trim', () => {
    expect(parseHomeIndex(block(' alt="  SV-P-12 "')).leaders[0].cover).toEqual({ setCode: 'SV-P', number: '12' });
  });

  it('aviso operativo: bloques > 0 y NINGUNA portada válida ⇒ logger.warn (no bloquea)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const r = parseHomeIndex(homeSinPortada);
      expect(r.totalBlocks).toBe(6);
      expect(r.leaders.every((l) => l.cover === null)).toBe(true);
      expect(warn.mock.calls.some((c) => /portada/i.test(String(c[0])))).toBe(true);
      warn.mockClear();
      parseHomeIndex(homeHtml);
      expect(warn.mock.calls.some((c) => /portada/i.test(String(c[0])))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

// ── P3–P6 — refresh con el MATCHER REAL sobre un catálogo en memoria ──────────────────────────────

/**
 * Catálogo: `TWM` trae 130 (Dragapult ex, está en la lista) y **025** (con ceros: la portada `TWM-25`
 * sólo casa si se usa el MISMO `normalizeNumber` que las 60). `SCR` existe sin la 58 ⇒
 * `unmatched_number`. `MEG`/`JTG`/`PBL` no están ⇒ `unmatched_set`.
 */
const SETS = [
  { id: 'set-twm', ptcgoCode: 'TWM' },
  { id: 'set-scr', ptcgoCode: 'SCR' },
];
const CARDS = [
  { id: 'card-twm-130', setId: 'set-twm', number: '130', name: 'Dragapult ex', supertype: 'Pokémon', externalId: 'sv6-130', imageLargeUrl: 'https://img/twm-130.png', imageSmallUrl: null },
  { id: 'card-twm-025', setId: 'set-twm', number: '025', name: 'Portada Sintética', supertype: 'Pokémon', externalId: 'sv6-25', imageLargeUrl: null, imageSmallUrl: 'https://img/twm-025-small.png' },
  { id: 'card-scr-1', setId: 'set-scr', number: '1', name: 'Otra', supertype: 'Pokémon', externalId: 'sv7-1', imageLargeUrl: null, imageSmallUrl: null },
];

function fakePrisma(dial: 'on' | 'off') {
  const writes = { listCreate: [] as any[], listUpdate: [] as any[], deckUpsert: [] as any[], deckUpdate: [] as any[], fetchRun: [] as any[] };
  let seq = 0;
  const tx = {
    metaDeck: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ where, create }: any) => {
        writes.deckUpsert.push(where.slug);
        return { id: `deck-${where.slug}`, currentListId: null, ...create };
      }),
      update: jest.fn(async (a: any) => { writes.deckUpdate.push(a); return {}; }),
    },
    metaDeckList: {
      create: jest.fn(async ({ data }: any) => { writes.listCreate.push(data); return { id: `list-${++seq}` }; }),
      update: jest.fn(async (a: any) => { writes.listUpdate.push(a); return {}; }),
    },
  };
  const prisma = {
    configSetting: {
      findMany: jest.fn(async () => [
        { key: DIAL_AUTOFETCH, valueJson: dial },
        { key: DIAL_AUTOPUBLISH, valueJson: true },
      ]),
    },
    cardSet: { findMany: jest.fn(async () => SETS) },
    card: {
      findMany: jest.fn(async ({ where }: any) =>
        CARDS.filter((c) => where.setId.in.includes(c.setId)).map((c) => ({ ...c, set: SETS.find((s) => s.id === c.setId) })),
      ),
    },
    metaDeck: tx.metaDeck,
    metaDeckList: tx.metaDeckList,
    metaFetchRun: { create: jest.fn(async ({ data }: any) => { writes.fetchRun.push(data); return {}; }) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, writes };
}

const LOOSE_CANARY = {
  META_FETCH_DELAY_MS: '0',
  META_CANARY_MATCH_FLOOR: '0',
  META_CANARY_UNMATCHED_SET_MAX_RATIO: '1',
};

function build(dial: 'on' | 'off', home = homeHtml) {
  const { prisma, writes } = fakePrisma(dial);
  const client = {
    fetchHome: jest.fn(async () => home),
    fetchDeckList: jest.fn(async () => decklistHtml),
  } as unknown as LimitlessFetchClient;
  const matcher = new DeckMatcherService(prisma);
  const svc = new DecksMetaRefreshService(prisma, new ConfigService(LOOSE_CANARY), matcher, client);
  return { svc, writes, matcher };
}

async function live(home = homeHtml) {
  const h = build('on', home);
  const r = await h.svc.run({});
  if (r.skipped) throw new Error('no debía saltarse');
  return { report: r.report, writes: h.writes, matcher: h.matcher };
}

const coverCols = (d: any) => ({
  coverSetCode: d.coverSetCode ?? null,
  coverNumber: d.coverNumber ?? null,
  coverMatchStatus: d.coverMatchStatus ?? null,
  coverCardId: d.coverCardId ?? null,
});

describe('P3 · portada casada con número con CEROS en BD (TWM-25 ↔ «025"), mismo normalizeNumber que las 60', () => {
  it('la lista del 2.º deck se persiste con coverCardId = la carta 025 y coverMatchStatus=matched', async () => {
    const { writes } = await live();
    expect(writes.listCreate).toHaveLength(6);
    expect(coverCols(writes.listCreate[1])).toEqual({
      coverSetCode: 'TWM',
      coverNumber: '25', // crudo, SIN normalizar
      coverMatchStatus: 'matched',
      coverCardId: 'card-twm-025',
    });
    // Y la del 1.º (TWM-130, que además está entre las 60).
    expect(coverCols(writes.listCreate[0])).toEqual({ coverSetCode: 'TWM', coverNumber: '130', coverMatchStatus: 'matched', coverCardId: 'card-twm-130' });
  });

  it('matchCover DELEGA en matchLines con UNA línea sintética (quantity 1, pokemon, no básica)', async () => {
    const { prisma } = fakePrisma('on');
    const matcher = new DeckMatcherService(prisma);
    const spy = jest.spyOn(matcher, 'matchLines');
    const out = await matcher.matchCover({ setCode: 'TWM', number: '25' });
    expect(out.matchStatus).toBe('matched');
    expect(out.card?.id).toBe('card-twm-025');
    expect(spy).toHaveBeenCalledTimes(1);
    const [lines] = spy.mock.calls[0];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 1, group: 'pokemon', isBasicEnergy: false, setCode: 'TWM', number: '25' });
  });
});

describe('TD-c · la portada NUNCA es `unmatched_basic_energy` (tipo + guarda en ejecución)', () => {
  it('si el motor devolviera `unmatched_basic_energy`, matchCover LANZA (el refresh lo trata como fallo de portada)', async () => {
    const { prisma } = fakePrisma('on');
    const matcher = new DeckMatcherService(prisma);
    jest.spyOn(matcher, 'matchLines').mockResolvedValue([
      { quantity: 1, rawName: 'x', rawSetCode: 'TWM', rawNumber: '25', group: 'pokemon', matchStatus: 'unmatched_basic_energy', matchedCard: null } as any,
    ]);
    await expect(matcher.matchCover({ setCode: 'TWM', number: '25' })).rejects.toThrow(/energía básica/);
  });

  it('tipo: `CoverMatchStatus` excluye `unmatched_basic_energy`', () => {
    // @ts-expect-error — si el tipo volviera a ser `MetaMatchStatus`, esta línea compilaría y tsc fallaría.
    const bad: CoverMatchStatus = 'unmatched_basic_energy';
    const ok: CoverMatchStatus = 'unmatched_number';
    expect([bad, ok]).toHaveLength(2);
  });
});

describe('P4 · portada NO casada: se guarda el crudo + estado, y NO cambia el veredicto ni lo persistido', () => {
  it('MEG-56 (set ausente) ⇒ unmatched_set; SCR-58 (número inexistente) ⇒ unmatched_number; coverCardId null', async () => {
    const { writes } = await live();
    expect(coverCols(writes.listCreate[2])).toEqual({ coverSetCode: 'MEG', coverNumber: '56', coverMatchStatus: 'unmatched_set', coverCardId: null });
    expect(coverCols(writes.listCreate[4])).toEqual({ coverSetCode: 'SCR', coverNumber: '58', coverMatchStatus: 'unmatched_number', coverCardId: null });
  });

  it('verdict, published y persistedCount IGUALES al mismo run sin portada (home sin `alt`)', async () => {
    const con = await live();
    const sin = await live(homeSinPortada);
    expect(con.report.verdict).toBe('PUBLISH');
    expect(con.report.verdict).toBe(sin.report.verdict);
    expect(con.report.persistedCount).toBe(6);
    expect(con.report.persistedCount).toBe(sin.report.persistedCount);
    expect(con.report.publishedSlugs).toEqual(sin.report.publishedSlugs);
    expect(con.report.canary).toEqual(sin.report.canary);
    // Sin portada: las 4 columnas null en TODAS las listas (invariante todo-null).
    for (const d of sin.writes.listCreate) {
      expect(coverCols(d)).toEqual({ coverSetCode: null, coverNumber: null, coverMatchStatus: null, coverCardId: null });
    }
    expect(sin.report.decks.every((d) => d.cover === null)).toBe(true);
  });
});

describe('P5 · la portada NO se cuela en las 60 (candado de no-regresión)', () => {
  it('MetaDeckCard persistidas = líneas parseadas; sumQuantity/matched/total sin cambio (también con la portada DENTRO de la lista)', async () => {
    const parsed = parseDeckListHtml(decklistHtml).lines;
    const con = await live();
    const sin = await live(homeSinPortada);
    for (let i = 0; i < 6; i++) {
      expect(con.writes.listCreate[i].cards.create).toHaveLength(parsed.length);
      expect(con.writes.listCreate[i].cards.create).toEqual(sin.writes.listCreate[i].cards.create);
      expect(con.report.decks[i].sumQuantity).toBe(60);
      expect(con.report.decks[i].cardsParsed).toBe(sin.report.decks[i].cardsParsed);
      expect(con.report.decks[i].matched).toBe(sin.report.decks[i].matched);
      expect(con.report.decks[i].total).toBe(sin.report.decks[i].total);
      expect(con.report.decks[i].matchStatusBreakdown).toEqual(sin.report.decks[i].matchStatusBreakdown);
    }
    // El deck 0 tiene portada TWM-130 que TAMBIÉN está en la lista: una sola línea con esa carta.
    expect(con.writes.listCreate[0].cards.create.filter((c: any) => c.matchedCardId === 'card-twm-130')).toHaveLength(1);
  });
});

describe('P6 · ensayo (dry-run): decks[].cover con imagen de NUESTRO catálogo y CERO escrituras', () => {
  it('cover presente por deck; imageUrl = imageLargeUrl ?? imageSmallUrl de la carta casada', async () => {
    const { svc, writes } = build('off');
    const r = await svc.run({ dryRun: true });
    if (r.skipped) throw new Error('no debía saltarse');
    expect(r.mode).toBe('dryrun');
    expect(r.report.decks.map((d) => d.cover)).toEqual([
      { setCode: 'TWM', number: '130', matchStatus: 'matched', cardId: 'card-twm-130', imageUrl: 'https://img/twm-130.png' },
      { setCode: 'TWM', number: '25', matchStatus: 'matched', cardId: 'card-twm-025', imageUrl: 'https://img/twm-025-small.png' },
      { setCode: 'MEG', number: '56', matchStatus: 'unmatched_set', cardId: null, imageUrl: null },
      { setCode: 'JTG', number: '98', matchStatus: 'unmatched_set', cardId: null, imageUrl: null },
      { setCode: 'SCR', number: '58', matchStatus: 'unmatched_number', cardId: null, imageUrl: null },
      { setCode: 'PBL', number: '65', matchStatus: 'unmatched_set', cardId: null, imageUrl: null },
    ]);
    // Nunca arte externo: ninguna URL de la CDN de Limitless en el reporte.
    expect(JSON.stringify(r.report)).not.toContain('limitlesstcg.nyc3');
    // CERO escrituras.
    expect(writes.deckUpsert).toHaveLength(0);
    expect(writes.listCreate).toHaveLength(0);
    expect(writes.listUpdate).toHaveLength(0);
    expect(writes.deckUpdate).toHaveLength(0);
    expect(writes.fetchRun).toHaveLength(0);
  });

  it('un deck cuya lista falla (error) reporta cover:null', async () => {
    const { prisma } = fakePrisma('off');
    const client = {
      fetchHome: jest.fn(async () => homeHtml),
      fetchDeckList: jest.fn(async () => { throw new Error('boom'); }),
    } as unknown as LimitlessFetchClient;
    const svc = new DecksMetaRefreshService(prisma, new ConfigService(LOOSE_CANARY), new DeckMatcherService(prisma), client);
    const r = await svc.run({ dryRun: true });
    if (r.skipped) throw new Error('no debía saltarse');
    expect(r.report.decks.every((d) => d.error && d.cover === null)).toBe(true);
  });
});

describe('C-1 · `matchCover` FALLA: el deck sigue SIN portada, no pasa a `error` y el fallo llega a `errors[]`', () => {
  it('TWM-25 lanza ⇒ deck 2 sin portada (4 columnas null), verdict/persistedCount/canary iguales y `cover TWM-25: …` en errors', async () => {
    const base = await live();
    const h = build('on');
    const real = h.matcher.matchCover.bind(h.matcher);
    jest.spyOn(h.matcher, 'matchCover').mockImplementation(async (c) => {
      if (c.setCode === 'TWM' && c.number === '25') throw new Error('db caída');
      return real(c);
    });
    const r = await h.svc.run({});
    if (r.skipped) throw new Error('no debía saltarse');
    const rep = r.report;
    // No convierte el deck en `error`: se persiste igual, sin portada.
    expect(rep.decks[1].error).toBeUndefined();
    expect(rep.decks[1].cover).toBeNull();
    expect(coverCols(h.writes.listCreate[1])).toEqual({ coverSetCode: null, coverNumber: null, coverMatchStatus: null, coverCardId: null });
    // El resto de portadas intactas.
    expect(coverCols(h.writes.listCreate[0])).toEqual(coverCols(base.writes.listCreate[0]));
    // Ni veredicto, ni canario, ni lo persistido cambian.
    expect(rep.verdict).toBe(base.report.verdict);
    expect(rep.canary).toEqual(base.report.canary);
    expect(rep.persistedCount).toBe(base.report.persistedCount);
    expect(rep.publishedSlugs).toEqual(base.report.publishedSlugs);
    // Y el fallo es visible en el reporte (y en el `note` del MetaFetchRun), con prefijo propio.
    expect(base.report.errors).toEqual([]);
    expect(rep.errors).toHaveLength(1);
    // Forma EXACTA del contrato (§13 Admin fila 4b): `cover <SET>-<NÚM>: <msg>`.
    expect(rep.errors).toEqual(['cover TWM-25: db caída']);
    expect(h.writes.fetchRun[0].note).toContain('cover TWM-25');
  });
});

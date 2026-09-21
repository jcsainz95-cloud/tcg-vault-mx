import type { ConfigService } from '@nestjs/config';
import { MetaDeckSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DecksMetaService } from './decks-meta.service';
import { DeckMatcherService, MatchedLine } from './deck-matcher.service';
import { LimitlessFetchClient } from './limitless-fetch.client';
import { DecksMetaRefreshService, RefreshReport, buildRunNote } from './decks-meta-refresh.service';

/**
 * DECKS-META Fase 2 (§4) — el ORQUESTADOR: dos invariantes que QA marcó sin cubrir.
 *
 *  1. `deckCount` en `MetaFetchRun` = arquetipos EFECTIVAMENTE persistidos este run, NO
 *     `publishedSlugs + supersededListIds` (fórmula que ni contaba los decks nuevos sin publicar ni
 *     distinguía el deck publicado que además supersedió). Escenario MIXTO:
 *       Alpha  — nuevo, no publicado           → persiste (0 published, 0 superseded)
 *       Delta  — nuevo, no publicado           → persiste (0 published, 0 superseded)
 *       Beta   — existente, publicado, c/lista → persiste (1 published, 1 superseded)
 *       Charlie— manual                         → NO persiste (manual gana)
 *     persistidos = 3; la fórmula vieja daría 1+1 = 2. El candado exige 3.
 *
 *  2. `note` (§4/§9) es SIEMPRE JSON válido dentro del cap: se acotan las ENTRADAS antes de
 *     serializar y, si aun así excede, se guarda un marcador truncado VÁLIDO (nunca una cadena
 *     cortada a mitad).
 *
 * FUENTE-CONFIABLE (SUP-LEG): el pipeline ya NO deriva legalidad (Limitless publica sólo listas
 * Standard-legal) ⇒ no hay `loadLegalityConfig`, ni `legalityConfig`/`legalityDrops`/diagnóstico.
 */
describe('DecksMetaRefreshService (§4) — deckCount = persistidos + note JSON válido', () => {
  const HOME_HTML = [
    '<h2>Top Decks (STD)</h2>',
    '<div class="top-leaders">',
    '  <div class="leader"><a class="leader-details" href="/decks/101"><div class="text-lg font-bold">1. Alpha</div></a><a class="leader-decklist" href="/decks/list/201"></a></div>',
    '  <div class="leader"><a class="leader-details" href="/decks/102"><div class="text-lg font-bold">2. Delta</div></a><a class="leader-decklist" href="/decks/list/202"></a></div>',
    '  <div class="leader"><a class="leader-details" href="/decks/103"><div class="text-lg font-bold">3. Beta</div></a><a class="leader-decklist" href="/decks/list/203"></a></div>',
    '  <div class="leader"><a class="leader-details" href="/decks/104"><div class="text-lg font-bold">4. Charlie</div></a><a class="leader-decklist" href="/decks/list/204"></a></div>',
    '</div>',
  ].join('\n');

  // Config: apaga el espaciado y BAJA los umbrales del canary para que el escenario mínimo publique.
  const configMap: Record<string, string> = {
    META_FETCH_DELAY_MS: '0',
    META_CANARY_MIN_DECKS: '1',
    META_CANARY_CARDS_MIN: '1',
    META_CANARY_CARDS_MAX: '999',
    META_CANARY_MATCH_FLOOR: '0',
    META_CANARY_UNMATCHED_SET_MAX_RATIO: '1',
  };
  const config = { get: (k: string) => configMap[k] } as unknown as ConfigService;

  // Una línea casada de 60 por deck ⇒ sumQuantity 60, ratio de match 1 (canary PUBLISH).
  const matchedLine = (): MatchedLine => ({
    quantity: 60,
    rawName: 'Card',
    rawSetCode: 'STD',
    rawNumber: '1',
    group: 'pokemon',
    matchStatus: 'matched' as MatchedLine['matchStatus'],
    matchedCard: null,
  });

  function makeHarness() {
    const client = {
      fetchHome: jest.fn(async () => HOME_HTML),
      fetchDeckList: jest.fn(async () => '<div></div>'),
    } as unknown as LimitlessFetchClient;

    const matcher = {
      matchLines: jest.fn(async () => [matchedLine()]),
    } as unknown as DeckMatcherService;

    // SUP-LEG: el refresh ya no consulta al servicio por legalidad; se inyecta vacío.
    const deckMeta = {} as unknown as DecksMetaService;

    // Estado previo por slug: Beta existe (publicado, con lista) y Charlie es manual.
    const existingBySlug: Record<string, { id: string; published: boolean; source: MetaDeckSource; currentListId: string | null; pausedByOperator: boolean; sharePct: number | null }> = {
      beta: { id: 'deck-beta', published: true, source: MetaDeckSource.limitless, currentListId: 'list-old-beta', pausedByOperator: false, sharePct: null },
      charlie: { id: 'deck-charlie', published: false, source: MetaDeckSource.manual, currentListId: null, pausedByOperator: false, sharePct: null },
    };

    let listSeq = 0;
    const tx = {
      metaDeck: {
        findUnique: jest.fn(async ({ where: { slug } }: { where: { slug: string } }) => existingBySlug[slug] ?? null),
        upsert: jest.fn(async ({ where: { slug } }: { where: { slug: string } }) => {
          const ex = existingBySlug[slug];
          return { id: ex?.id ?? `deck-${slug}`, currentListId: ex?.currentListId ?? null };
        }),
        update: jest.fn(async () => ({})),
      },
      metaDeckList: {
        create: jest.fn(async () => ({ id: `newlist-${listSeq++}` })),
        update: jest.fn(async () => ({})),
      },
    };

    const created: { data: { deckCount: number; applied: boolean; note: string; formatVersion: string } }[] = [];
    const prisma = {
      configSetting: {
        findMany: jest.fn(async () => [
          { key: 'decks_meta_autofetch', valueJson: 'on' },
          { key: 'decks_meta_autofetch_autopublish', valueJson: false },
        ]),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      metaFetchRun: { create: jest.fn(async (args: (typeof created)[number]) => { created.push(args); return {}; }) },
    } as unknown as PrismaService;

    const service = new DecksMetaRefreshService(prisma, config, deckMeta, matcher, client);
    return { service, created, tx };
  }

  it('deckCount = 3 persistidos (Alpha+Delta+Beta), NO 2 de la fórmula published+superseded', async () => {
    const { service, created } = makeHarness();
    const result = await service.run({}); // modo vivo (dial `on`)

    expect(result.skipped).toBe(false);
    if (result.skipped) return; // narrowing para TS
    expect(result.report.applied).toBe(true);
    expect(result.report.persistedCount).toBe(3);
    // El deck manual quedó registrado como conflicto, no persistido.
    expect(result.report.manualConflicts).toEqual(['charlie']);
    // Sólo Beta se publicó y supersedió: la fórmula vieja daría 1+1=2.
    expect(result.report.publishedSlugs).toEqual(['beta']);
    expect(result.report.supersededListIds).toEqual(['list-old-beta']);

    // Lo que se PERSISTE en MetaFetchRun.deckCount es el conteo real de arquetipos aplicados.
    expect(created).toHaveLength(1);
    expect(created[0].data.deckCount).toBe(3);
    expect(created[0].data.deckCount).not.toBe(result.report.publishedSlugs.length + result.report.supersededListIds.length);
    expect(created[0].data.applied).toBe(true);
  });

  it('las MetaDeckList creadas persisten activeMarksSnapshot vacío (columna inerte, SUP-LEG)', async () => {
    const { service, tx } = makeHarness();
    await service.run({});
    const createCalls = (tx.metaDeckList.create as jest.Mock).mock.calls;
    expect(createCalls.length).toBeGreaterThan(0);
    for (const [args] of createCalls) {
      expect(args.data.activeMarksSnapshot).toEqual([]);
    }
  });

  it('la note del run es JSON VÁLIDO y trae persistedCount, SIN legalityConfig/legalityDrops', async () => {
    const { service, created } = makeHarness();
    await service.run({});
    const note = created[0].data.note;
    expect(() => JSON.parse(note)).not.toThrow();
    const parsed = JSON.parse(note);
    expect(parsed.persistedCount).toBe(3);
    expect(parsed.legalityConfig).toBeUndefined();
    for (const d of parsed.perDeckCounts ?? []) {
      expect(d).not.toHaveProperty('legalityDrops');
      expect(d).not.toHaveProperty('legalityBreakdown');
      expect(d).not.toHaveProperty('marksSeen');
    }
    expect(note.length).toBeLessThanOrEqual(8000);
  });

  it('buildRunNote: entradas ENORMES ⇒ marcador truncado VÁLIDO dentro del cap (nunca cadena cortada)', () => {
    // 500 errores largos harían que un `.slice(0,8000)` cortara a mitad de cadena → JSON inválido.
    const bigErrors = Array.from({ length: 500 }, (_, i) => `error #${i}: ` + 'x'.repeat(200));
    const report = {
      mode: 'live',
      formatCode: 'STD',
      canary: { verdict: 'NO_PUBLISH', reason: 'C1 falló', checks: [] },
      persistedCount: 0,
      decks: [],
      urlsFetched: ['home'],
      publishedSlugs: [],
      supersededListIds: [],
      manualConflicts: [],
      pausedSkipped: [],
      errors: bigErrors,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
    } as unknown as RefreshReport;

    const note = buildRunNote(report);
    expect(note.length).toBeLessThanOrEqual(8000);
    const parsed = JSON.parse(note); // no lanza ⇒ JSON válido
    expect(parsed.truncated).toBe(true);
    expect(parsed.errorsCount).toBe(500);
  });

  it('buildRunNote: reporte normal serializa completo (sin marcador de truncado, sin legalidad)', () => {
    const report = {
      mode: 'live',
      canary: { verdict: 'PUBLISH', reason: null, checks: [{ id: 'C1', ok: true, measured: 3, threshold: 1 }] },
      persistedCount: 3,
      decks: [{ archetypeId: '101', name: 'Alpha', sumQuantity: 60, matched: 1, total: 1 }],
      urlsFetched: ['home', 'list/201'],
      publishedSlugs: ['beta'],
      supersededListIds: ['list-old-beta'],
      manualConflicts: ['charlie'],
      pausedSkipped: [],
      errors: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
    } as unknown as RefreshReport;

    const parsed = JSON.parse(buildRunNote(report));
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.persistedCount).toBe(3);
    expect(parsed.legalityConfig).toBeUndefined();
    expect(parsed.perDeckCounts).toHaveLength(1);
    expect(parsed.perDeckCounts[0]).not.toHaveProperty('legalityDrops');
  });
});

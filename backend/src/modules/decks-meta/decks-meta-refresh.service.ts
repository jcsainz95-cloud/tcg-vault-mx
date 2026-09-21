import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaDeckSource, MetaMatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isLegalStandardNow, StandardLegalityConfig } from '../../common/standard-legality';
import { DecksMetaService } from './decks-meta.service';
import { DeckMatcherService, MatchedLine } from './deck-matcher.service';
import { LimitlessFetchClient } from './limitless-fetch.client';
import { parseHomeIndex, parseDeckListHtml, HomeLeader } from './limitless-html.parser';
import { evaluateCanary, CanaryResult, DeckCanarySummary } from './canary';
import {
  AutofetchDial,
  DIAL_AUTOFETCH,
  DIAL_AUTOPUBLISH,
  buildFormatLabel,
  normalizeAutofetchDial,
  normalizeAutopublishDial,
  resolveCanaryThresholds,
  resolveFetchConfig,
  slugifyDeckName,
} from './limitless.config';

/**
 * DECKS-META Fase 2 — ORQUESTADOR del auto-fetch semanal. Norma: spec §1, §4, §5, §6, §8.
 *
 * Flujo: home → N bloques `.leader` → por cada uno, GET `/decks/list/<listId>` (secuencial, con
 * delay) → parsear las ~60 → matchear (Fase 1, REUSADO) → CANARY (gate duro) → si pasa Y modo vivo:
 * persistir `MetaDeckList` nueva e inmutable + supersede. Dry-run corre TODO pero NO escribe nada.
 *
 * Diales (ConfigSetting, leídos directo como la ventana de legalidad de Fase 1):
 *  - `decks_meta_autofetch`: off (default, fail-closed, no-op) | dryrun | on.
 *  - `decks_meta_autofetch_autopublish`: bool (default false). En `on`+canary: la lista se guarda;
 *    `published` sólo se enciende si este dial es true (conservador: si no, el operador lo flipa).
 *
 * Single-flight: flag en memoria (worker BullMQ y HTTP admin viven en el MISMO proceso).
 */
@Injectable()
export class DecksMetaRefreshService {
  private readonly logger = new Logger(DecksMetaRefreshService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly deckMeta: DecksMetaService,
    private readonly matcher: DeckMatcherService,
    private readonly client: LimitlessFetchClient,
  ) {}

  /** Espera cancelable (aislada para mockear timers en test; el espaciado entre requests, §1). */
  protected async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  private async readDials(): Promise<{ mode: AutofetchDial; autopublish: boolean }> {
    const rows = await this.prisma.configSetting.findMany({
      where: { key: { in: [DIAL_AUTOFETCH, DIAL_AUTOPUBLISH] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.valueJson]));
    return {
      mode: normalizeAutofetchDial(byKey.get(DIAL_AUTOFETCH)),
      autopublish: normalizeAutopublishDial(byKey.get(DIAL_AUTOPUBLISH)),
    };
  }

  /**
   * Punto de entrada del job semanal y del disparo manual.
   * - `dryRun:true` fuerza el modo dry-run SIEMPRE (la vía de verificación en prod, operador).
   * - Sin `dryRun`: respeta el dial. `off` ⇒ no-op logueado (fail-closed, cero egress).
   */
  async run(opts: { dryRun?: boolean } = {}): Promise<RefreshRunResult> {
    // Single-flight: el flag se reclama SÍNCRONAMENTE, antes de cualquier `await` (si no, dos
    // corridas concurrentes pasan las dos el chequeo y se solapan). Worker BullMQ y HTTP admin
    // viven en el MISMO proceso, así que el flag cubre ambos.
    if (this.running) {
      this.logger.warn('decks-meta-refresh ya en curso; no se lanza otro (single-flight).');
      return { skipped: true, reason: 'ALREADY_RUNNING', mode: 'skipped' };
    }
    this.running = true;
    try {
      const dials = await this.readDials();
      // `off` + no dry-run explícito ⇒ no-op. Encender es una acción deliberada de operación (§8).
      if (!opts.dryRun && dials.mode === 'off') {
        this.logger.log('decks-meta-refresh: dial decks_meta_autofetch=off → no-op (fail-closed, §8).');
        return { skipped: true, reason: 'DIAL_OFF', mode: 'off' };
      }
      const live = !opts.dryRun && dials.mode === 'on';
      const mode: RefreshMode = live ? 'live' : 'dryrun';
      const report = await this.pipeline(mode, dials.autopublish);
      return { skipped: false, report, mode };
    } finally {
      this.running = false;
    }
  }

  /** Ejecuta el pipeline completo (fetch→parse→match→canary→[persist]). Devuelve el reporte. */
  private async pipeline(mode: RefreshMode, autopublish: boolean): Promise<RefreshReport> {
    const startedAt = new Date();
    const fetchCfg = resolveFetchConfig(this.config);
    const thresholds = resolveCanaryThresholds(this.config);
    const urlsFetched: string[] = [];
    const errors: string[] = [];

    // [1] HOME
    let home: ReturnType<typeof parseHomeIndex> | null = null;
    try {
      const html = await this.client.fetchHome();
      urlsFetched.push('home');
      home = parseHomeIndex(html);
    } catch (e) {
      errors.push(`home: ${(e as Error).message}`);
    }

    const formatCode = home?.formatCode ?? null;
    const formatLabel = buildFormatLabel(formatCode);
    const cfg = await this.deckMeta.loadLegalityConfig();

    // Candidatos: bloques con archetypeId + listId válidos, en orden de rank; tope N (§1).
    const candidates = (home?.leaders ?? [])
      .filter((l): l is HomeLeader & { archetypeId: string; listId: string } =>
        l.archetypeId != null && l.listId != null,
      )
      .slice(0, fetchCfg.topN);
    const leadersWithListId = (home?.leaders ?? []).filter((l) => l.listId != null).length;

    // [3] Por cada arquetipo: fetch de su lista completa + parse + match. SECUENCIAL con delay (§1).
    const deckReports: DeckReport[] = [];
    const parsedDecks: ParsedDeck[] = [];
    let requestsUsed = 1; // la home ya consumió uno
    for (const c of candidates) {
      if (requestsUsed >= fetchCfg.maxRequests) {
        this.logger.warn(`decks-meta-refresh: cota dura de ${fetchCfg.maxRequests} requests alcanzada; se detiene el fetch.`);
        break;
      }
      if (fetchCfg.delayMs > 0) await this.sleep(fetchCfg.delayMs);
      requestsUsed += 1;
      try {
        const html = await this.client.fetchDeckList(c.listId);
        urlsFetched.push(`list/${c.listId}`);
        const { lines } = parseDeckListHtml(html);
        const matched = await this.matcher.matchLines(lines);
        const summary = summarize(c, matched);
        const report = toDeckReport(c, matched, cfg, thresholds.cardsMin, thresholds.cardsMax);
        parsedDecks.push({ leader: c, matched, summary });
        deckReports.push(report);
      } catch (e) {
        const msg = `list/${c.listId} (${c.name ?? '??'}): ${(e as Error).message}`;
        errors.push(msg);
        deckReports.push(errorDeckReport(c, (e as Error).message));
      }
    }

    // [4] CANARY (en memoria, antes de cualquier escritura).
    const canary = evaluateCanary(
      {
        homeParseable: home != null && (home.totalBlocks ?? 0) > 0,
        leadersWithListId,
        decks: parsedDecks.map((p) => p.summary),
      },
      thresholds,
    );

    const base: RefreshReport = {
      mode,
      formatCode,
      formatLabel,
      autopublish,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      urlsFetched,
      decks: deckReports,
      canary,
      legalityConfig: { activeMarks: cfg.activeMarks, banlistCardIds: cfg.banlistCardIds },
      verdict: canary.verdict,
      wouldPublish: canary.verdict === 'PUBLISH',
      applied: false,
      persistedCount: 0,
      publishedSlugs: [],
      supersededListIds: [],
      manualConflicts: [],
      pausedSkipped: [],
      errors,
    };

    // [5] Dry-run: NO escribe NADA (ni MetaDeckList, ni currentListId, ni published, ni MetaFetchRun).
    if (mode === 'dryrun') {
      this.logAlertIfNeeded(canary, mode);
      base.finishedAt = new Date().toISOString();
      return base;
    }

    // Modo vivo. Canary falla ⇒ conservar último-bueno + MetaFetchRun{applied:false} + alerta (§5).
    if (canary.verdict === 'NO_PUBLISH') {
      this.logAlertIfNeeded(canary, mode);
      await this.recordRun(base, false);
      base.finishedAt = new Date().toISOString();
      return base;
    }

    // Canary pasa: persistir por deck (supersede-based), respetando pausa y manual-gana.
    for (const p of parsedDecks) {
      try {
        const outcome = await this.persistDeck(p, { formatLabel, activeMarks: cfg.activeMarks, sourceTournament: p.leader.sourceTournament }, autopublish);
        if (outcome.skippedReason === 'paused') base.pausedSkipped.push(outcome.slug);
        else if (outcome.skippedReason === 'manual') base.manualConflicts.push(outcome.slug);
        else {
          // Deck efectivamente persistido este run (MetaDeckList nueva creada), esté publicado o no
          // y tenga o no lista previa que superseder. Es el conteo de «arquetipos aplicados» (§4).
          base.persistedCount += 1;
          if (outcome.supersededListId) base.supersededListIds.push(outcome.supersededListId);
          if (outcome.published) base.publishedSlugs.push(outcome.slug);
        }
      } catch (e) {
        errors.push(`persist ${p.leader.name ?? p.leader.archetypeId}: ${(e as Error).message}`);
      }
    }

    base.applied = true;
    await this.recordRun(base, true);
    base.finishedAt = new Date().toISOString();
    return base;
  }

  /**
   * Persiste UN deck en su propia `$transaction` (patrón `adminCreateOrCurate` de Fase 1):
   * upsert deck (source=limitless) → `MetaDeckList` nueva e inmutable → cards → supersede → re-apuntar
   * `currentListId`. Respeta `pausedByOperator` (se salta) y «manual gana» (no pisa `source=manual`).
   */
  private async persistDeck(
    p: ParsedDeck,
    meta: { formatLabel: string; activeMarks: string[]; sourceTournament: string | null },
    autopublish: boolean,
  ): Promise<PersistOutcome> {
    const slug = slugifyDeckName(p.leader.name ?? `deck-${p.leader.archetypeId}`);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.metaDeck.findUnique({ where: { slug } });

      // Freno del operador: un deck pausado no se toca (ni lista nueva ni currentList).
      if (existing?.pausedByOperator) return { slug, skippedReason: 'paused' as const, published: false, supersededListId: null };
      // Manual gana: el auto-fetch NO publica sobre un slug curado a mano (§6).
      if (existing && existing.source === MetaDeckSource.manual) {
        return { slug, skippedReason: 'manual' as const, published: false, supersededListId: null };
      }

      const trend = existing?.sharePct != null && p.leader.sharePct != null
        ? Math.round(p.leader.sharePct - existing.sharePct)
        : null;
      // `published`: sólo se enciende con autopublish; si no, se respeta el estado previo (operador flipa).
      const willPublish = autopublish ? true : existing?.published ?? false;

      const deck = await tx.metaDeck.upsert({
        where: { slug },
        create: {
          slug,
          name: p.leader.name ?? slug,
          source: MetaDeckSource.limitless,
          sourceRef: `/decks/${p.leader.archetypeId}`,
          rank: p.leader.rank ?? null,
          sharePct: p.leader.sharePct ?? null,
          trend,
          published: willPublish,
        },
        update: {
          name: p.leader.name ?? slug,
          source: MetaDeckSource.limitless,
          sourceRef: `/decks/${p.leader.archetypeId}`,
          rank: p.leader.rank ?? undefined,
          sharePct: p.leader.sharePct ?? undefined,
          trend: trend ?? undefined,
          ...(autopublish ? { published: true } : {}),
        },
      });

      const list = await tx.metaDeckList.create({
        data: {
          deckId: deck.id,
          formatLabel: meta.formatLabel,
          activeMarksSnapshot: meta.activeMarks as unknown as Prisma.InputJsonValue,
          sourceUrl: `https://limitlesstcg.com/decks/list/${p.leader.listId}`,
          sourceTournament: meta.sourceTournament ?? null,
          cards: {
            create: p.matched.map((m) => ({
              rawName: m.rawName,
              rawSetCode: m.rawSetCode,
              rawNumber: m.rawNumber,
              quantity: m.quantity,
              group: m.group,
              matchStatus: m.matchStatus,
              matchedCardId: m.matchedCard?.id ?? null,
            })),
          },
        },
      });

      let supersededListId: string | null = null;
      if (deck.currentListId && deck.currentListId !== list.id) {
        await tx.metaDeckList.update({ where: { id: deck.currentListId }, data: { supersededById: list.id } });
        supersededListId = deck.currentListId;
      }
      await tx.metaDeck.update({ where: { id: deck.id }, data: { currentListId: list.id } });

      return { slug, skippedReason: null, published: willPublish, supersededListId };
    });
  }

  /** Registra la corrida (provenance + canary) serializando el detalle como JSON en `note` (§4). */
  private async recordRun(report: RefreshReport, applied: boolean): Promise<void> {
    await this.prisma.metaFetchRun.create({
      data: {
        source: MetaDeckSource.limitless,
        formatVersion: report.formatCode ?? 'unknown',
        // `deckCount` = arquetipos EFECTIVAMENTE persistidos este run (§4), no una suma de listas
        // publicadas + supersedidas (que ni cuenta los decks nuevos sin publicar ni distingue el
        // deck publicado que además supersedió).
        deckCount: applied ? report.persistedCount : 0,
        applied,
        note: buildRunNote(report),
      },
    });
  }

  /** Alerta operativa (log de error visible) en fallo de canary/fetch (§5, §6). */
  private logAlertIfNeeded(canary: CanaryResult, mode: RefreshMode): void {
    if (canary.verdict === 'NO_PUBLISH') {
      this.logger.error(
        `decks-meta-refresh (${mode}): canary NO_PUBLISH — no se publica, se conserva el último-bueno. Motivo: ${canary.reason}`,
      );
    }
  }
}

// ── Tipos internos + helpers puros ────────────────────────────────────────────────────────────────

/** Cap del campo `note` (String? en BD). Se acota la ENTRADA para que el JSON quede SIEMPRE válido. */
const NOTE_MAX_LEN = 8000;
/** Tope de elementos por arreglo antes de serializar (evita cortar el JSON a mitad de cadena). */
const NOTE_MAX_ITEMS = 60;

/** Acota un arreglo a los primeros `n` elementos (copia sólo si hace falta). */
function capArray<T>(arr: T[], n: number): T[] {
  return arr.length > n ? arr.slice(0, n) : arr;
}

/**
 * Serializa el detalle de la corrida como JSON VÁLIDO acotado a `NOTE_MAX_LEN` (§4, §9). Se acotan
 * las ENTRADAS (arreglos) ANTES de serializar; si aun así excede el cap, se guarda un marcador
 * truncado VÁLIDO (nunca una cadena JSON cortada a mitad, que sería JSON inválido). Jamás HTML crudo.
 */
export function buildRunNote(report: RefreshReport): string {
  const detail = {
    mode: report.mode,
    canaryVerdict: report.canary.verdict,
    canaryReason: report.canary.reason,
    persistedCount: report.persistedCount,
    checks: report.canary.checks.map((c) => ({ id: c.id, ok: c.ok, measured: c.measured, threshold: c.threshold })),
    // DIAGNÓSTICO de legalidad (§2.3): la ventana usada y, por deck, el desglose y las marcas vistas.
    legalityConfig: report.legalityConfig
      ? { activeMarks: capArray(report.legalityConfig.activeMarks, NOTE_MAX_ITEMS), banlistCardIds: capArray(report.legalityConfig.banlistCardIds, NOTE_MAX_ITEMS) }
      : undefined,
    perDeckCounts: capArray(report.decks, NOTE_MAX_ITEMS).map((d) => ({ archetypeId: d.archetypeId, name: d.name, sumQuantity: d.sumQuantity, matched: d.matched, total: d.total, legalityDrops: d.legalityDrops, legalityBreakdown: d.legalityBreakdown, marksSeen: d.marksSeen })),
    urlsFetched: capArray(report.urlsFetched, NOTE_MAX_ITEMS),
    publishedSlugs: capArray(report.publishedSlugs, NOTE_MAX_ITEMS),
    supersededListIds: capArray(report.supersededListIds, NOTE_MAX_ITEMS),
    manualConflicts: capArray(report.manualConflicts, NOTE_MAX_ITEMS),
    pausedSkipped: capArray(report.pausedSkipped, NOTE_MAX_ITEMS),
    errors: capArray(report.errors, NOTE_MAX_ITEMS),
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
  };
  const note = JSON.stringify(detail);
  if (note.length <= NOTE_MAX_LEN) return note;

  // Sigue por encima del cap (p. ej. muchos errores largos): marcador truncado VÁLIDO y compacto.
  return JSON.stringify({
    truncated: true,
    mode: report.mode,
    canaryVerdict: report.canary.verdict,
    canaryReason: report.canary.reason,
    persistedCount: report.persistedCount,
    deckCount: report.decks.length,
    urlsFetchedCount: report.urlsFetched.length,
    errorsCount: report.errors.length,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
  });
}

type RefreshMode = 'live' | 'dryrun';

interface ParsedDeck {
  leader: HomeLeader & { archetypeId: string; listId: string };
  matched: MatchedLine[];
  summary: DeckCanarySummary;
}

interface PersistOutcome {
  slug: string;
  skippedReason: 'paused' | 'manual' | null;
  published: boolean;
  supersededListId: string | null;
}

export interface DeckReport {
  archetypeId: string;
  name: string | null;
  rank: number | null;
  sharePct: number | null;
  listId: string;
  cardsParsed: number;
  sumQuantity: number;
  matched: number;
  total: number;
  matchStatusBreakdown: Record<string, number>;
  legalityDrops: number;
  /**
   * DIAGNÓSTICO de legalidad (§2.3): categoriza CADA carta casada que falló `isLegalStandardNow`
   * por la PRIMERA razón aplicable (orden determinista `noMark → outOfWindow → banned`). Los tres
   * suman EXACTAMENTE `legalityDrops`. Sirve para distinguir la CAUSA de las caídas:
   *  - `noMark`      : `regulationMark` null/vacío (carta nunca poblada por el sync ⇒ CAUSA B).
   *  - `outOfWindow` : la marca existe pero no está en `activeMarks` (rotó, o la ventana está vacía).
   *  - `banned`      : `legalStandardRaw === 'Banned'` o `externalId` en la banlist de operación.
   */
  legalityBreakdown: { noMark: number; outOfWindow: number; banned: number };
  /**
   * Las marcas de regulación NO nulas DISTINTAS entre las cartas casadas de este deck. Array VACÍO
   * ⇒ las cartas no tienen marca alguna ⇒ CAUSA B (el sync nunca pobló `regulationMark`).
   */
  marksSeen: string[];
  inBand: boolean;
  error?: string;
}

export interface RefreshReport {
  mode: RefreshMode;
  formatCode: string | null;
  formatLabel: string;
  autopublish: boolean;
  startedAt: string;
  finishedAt: string;
  urlsFetched: string[];
  decks: DeckReport[];
  canary: CanaryResult;
  /**
   * DIAGNÓSTICO de legalidad (§2.3): la VENTANA que este run usó al derivar la legalidad, tal cual
   * salió de `ConfigSetting`. Responde por sí sola la CAUSA A: si `activeMarks` viene VACÍO, TODA
   * carta con marca cae como `outOfWindow` y ninguna puede ser legal — la ventana está sin configurar.
   */
  legalityConfig: { activeMarks: string[]; banlistCardIds: string[] };
  verdict: 'PUBLISH' | 'NO_PUBLISH';
  wouldPublish: boolean;
  applied: boolean;
  /** Arquetipos EFECTIVAMENTE persistidos este run (lista nueva creada), ni pausados ni manual-gana. */
  persistedCount: number;
  publishedSlugs: string[];
  supersededListIds: string[];
  manualConflicts: string[];
  pausedSkipped: string[];
  errors: string[];
}

export type RefreshRunResult =
  | { skipped: true; reason: 'ALREADY_RUNNING' | 'DIAL_OFF'; mode: 'skipped' | 'off' }
  | { skipped: false; report: RefreshReport; mode: RefreshMode };

function summarize(leader: HomeLeader & { archetypeId: string; listId: string }, matched: MatchedLine[]): DeckCanarySummary {
  return {
    archetypeId: leader.archetypeId,
    slug: slugifyDeckName(leader.name ?? `deck-${leader.archetypeId}`),
    name: leader.name ?? '',
    cardsParsed: matched.length,
    sumQuantity: matched.reduce((s, m) => s + m.quantity, 0),
    matched: matched.filter((m) => m.matchStatus === MetaMatchStatus.matched).length,
    total: matched.length,
    unmatchedSet: matched.filter((m) => m.matchStatus === MetaMatchStatus.unmatched_set).length,
  };
}

function toDeckReport(
  leader: HomeLeader & { archetypeId: string; listId: string },
  matched: MatchedLine[],
  cfg: StandardLegalityConfig,
  cardsMin: number,
  cardsMax: number,
): DeckReport {
  const breakdown: Record<string, number> = {};
  for (const m of matched) breakdown[m.matchStatus] = (breakdown[m.matchStatus] ?? 0) + 1;
  let legalityDrops = 0;
  // DIAGNÓSTICO (§2.3): categoriza cada caída y anota las marcas VISTAS, en la MISMA pasada (sin queries extra).
  const legalityBreakdown = { noMark: 0, outOfWindow: 0, banned: 0 };
  const marksSeenSet = new Set<string>();
  for (const m of matched) {
    if (m.matchStatus === MetaMatchStatus.matched && m.matchedCard) {
      const mark = m.matchedCard.regulationMark;
      if (mark) marksSeenSet.add(mark);
      const legal = isLegalStandardNow(
        { regulationMark: m.matchedCard.regulationMark, legalStandardRaw: m.matchedCard.legalStandardRaw, externalId: m.matchedCard.externalId },
        cfg,
      );
      if (!legal) {
        legalityDrops += 1;
        // PRIMERA razón aplicable, orden determinista noMark → outOfWindow → banned (los tres suman legalityDrops).
        if (!mark) legalityBreakdown.noMark += 1;
        else if (!cfg.activeMarks.includes(mark)) legalityBreakdown.outOfWindow += 1;
        else legalityBreakdown.banned += 1;
      }
    }
  }
  const sumQuantity = matched.reduce((s, m) => s + m.quantity, 0);
  return {
    archetypeId: leader.archetypeId,
    name: leader.name,
    rank: leader.rank,
    sharePct: leader.sharePct,
    listId: leader.listId,
    cardsParsed: matched.length,
    sumQuantity,
    matched: matched.filter((m) => m.matchStatus === MetaMatchStatus.matched).length,
    total: matched.length,
    matchStatusBreakdown: breakdown,
    legalityDrops,
    legalityBreakdown,
    marksSeen: [...marksSeenSet],
    inBand: sumQuantity >= cardsMin && sumQuantity <= cardsMax,
  };
}

function errorDeckReport(leader: HomeLeader & { archetypeId: string; listId: string }, error: string): DeckReport {
  return {
    archetypeId: leader.archetypeId,
    name: leader.name,
    rank: leader.rank,
    sharePct: leader.sharePct,
    listId: leader.listId,
    cardsParsed: 0,
    sumQuantity: 0,
    matched: 0,
    total: 0,
    matchStatusBreakdown: {},
    legalityDrops: 0,
    legalityBreakdown: { noMark: 0, outOfWindow: 0, banned: 0 },
    marksSeen: [],
    inBand: false,
    error,
  };
}

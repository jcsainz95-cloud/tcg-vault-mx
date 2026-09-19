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
      verdict: canary.verdict,
      wouldPublish: canary.verdict === 'PUBLISH',
      applied: false,
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
    const note = JSON.stringify({
      mode: report.mode,
      canaryVerdict: report.canary.verdict,
      canaryReason: report.canary.reason,
      checks: report.canary.checks.map((c) => ({ id: c.id, ok: c.ok, measured: c.measured, threshold: c.threshold })),
      perDeckCounts: report.decks.map((d) => ({ archetypeId: d.archetypeId, name: d.name, sumQuantity: d.sumQuantity, matched: d.matched, total: d.total })),
      urlsFetched: report.urlsFetched,
      publishedSlugs: report.publishedSlugs,
      supersededListIds: report.supersededListIds,
      manualConflicts: report.manualConflicts,
      pausedSkipped: report.pausedSkipped,
      errors: report.errors,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
    }).slice(0, 8000); // acotado: `note` es String?; nunca guarda HTML crudo (§9).

    await this.prisma.metaFetchRun.create({
      data: {
        source: MetaDeckSource.limitless,
        formatVersion: report.formatCode ?? 'unknown',
        deckCount: applied ? report.publishedSlugs.length + report.supersededListIds.length : 0,
        applied,
        note,
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
  verdict: 'PUBLISH' | 'NO_PUBLISH';
  wouldPublish: boolean;
  applied: boolean;
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
  for (const m of matched) {
    if (m.matchStatus === MetaMatchStatus.matched && m.matchedCard) {
      const legal = isLegalStandardNow(
        { regulationMark: m.matchedCard.regulationMark, legalStandardRaw: m.matchedCard.legalStandardRaw, externalId: m.matchedCard.externalId },
        cfg,
      );
      if (!legal) legalityDrops += 1;
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
    inBand: false,
    error,
  };
}

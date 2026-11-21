import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaDeckSource, MetaMatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoverMatch, CoverMatchStatus, DeckMatcherService, MatchedLine } from './deck-matcher.service';
import { imageOf } from './deck-image';
import { FetchBudgetExhaustedError, FetchBudget, LimitlessFetchClient } from './limitless-fetch.client';
import { parseHomeIndex, parseDeckListHtml, parseDecksIndex, parseArchetypeFirstList, parseArchetypeCover, HomeLeader } from './limitless-html.parser';
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
  deckSlugFor,
} from './limitless.config';

/**
 * DECKS-META Fase 2 — ORQUESTADOR del auto-fetch semanal. Norma: spec §1, §4, §5, §6, §8.
 *
 * Flujo (§DECKS-TOP-FUENTE): `/decks` → N filas → por cada una GET `/decks/<id>` (listId) y `/decks/list/<listId>` (1+2N GET; portada si falla) (secuencial, con
 * delay) → parsear las ~60 → matchear (Fase 1, REUSADO) → CANARY (gate duro) → si pasa Y modo vivo:
 * persistir `MetaDeckList` nueva e inmutable + supersede. Dry-run corre TODO pero NO escribe nada.
 *
 * Diales (ConfigSetting, leídos directo, fail-closed):
 *  - `decks_meta_autofetch`: off (default, fail-closed, no-op) | dryrun | on.
 *  - `decks_meta_autofetch_autopublish`: bool (default false). En `on`+canary: la lista se guarda;
 *    `published` sólo se enciende si este dial es true (conservador: si no, el operador lo flipa).
 *
 * Single-flight: flag en memoria (worker BullMQ y HTTP admin viven en el MISMO proceso).
 */
@Injectable()
export class DecksMetaRefreshService implements OnModuleInit {
  private readonly logger = new Logger(DecksMetaRefreshService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly matcher: DeckMatcherService,
    private readonly client: LimitlessFetchClient,
  ) {}

  /**
   * §DECKS-TOP-FUENTE.8 (regla «todo automático», HECHOS 2026-10-30): siembra el dial de autopublicación en `true`
   * SOLO si la fila no existe. `skipDuplicates` ⇒ jamás pisa un `false` (ni un `true`) puesto a propósito; idempotente.
   * `decks_meta_autofetch` NO se siembra (el encendido sigue siendo deliberado, §8).
   */
  async seedAutopublishDial(): Promise<void> {
    await this.prisma.configSetting.createMany({
      data: [{ key: DIAL_AUTOPUBLISH, valueJson: true, updatedBy: 'system:seed-decks-top-fuente' }],
      skipDuplicates: true,
    });
  }

  async onModuleInit(): Promise<void> {
    // Las suites e2e arrancan el AppModule y esperan el dial ausente (conservador); ahí no se siembra.
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.seedAutopublishDial();
    } catch (e) {
      this.logger.warn(`seed del dial ${DIAL_AUTOPUBLISH} falló (no bloquea el arranque): ${(e as Error).message}`);
    }
  }

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

  // ── «Publicar ahora» asíncrono (§DECKS-TOP-FUENTE.15) ─────────────────────────────────────────────────
  // Una corrida dura 1-2 min (peor caso >11 min con reintentos): un proxy cortaría la petición. El POST solo ENCOLA y el
  // estado se sondea. Cola en proceso (el single-flight ya es en memoria y worker + HTTP viven en el mismo proceso);
  // si el proceso reinicia, el job se pierde y el sondeo recibe 404 (el operador relanza; la corrida semanal no cambia).
  private readonly jobs = new Map<string, RefreshJob>();

  /**
   * Encola una corrida. IDEMPOTENTE: si ya hay una `queued|running` devuelve ESA (mismo `jobId`, `deduped:true`) sin
   * lanzar otra, aunque pida otro `dryRun`.
   */
  enqueue(opts: { dryRun?: boolean } = {}): { jobId: string; status: 'queued' | 'running'; deduped: boolean } {
    for (const j of this.jobs.values()) {
      if (j.status === 'queued' || j.status === 'running') return { jobId: j.jobId, status: j.status, deduped: true };
    }
    const job: RefreshJob = {
      jobId: randomUUID(),
      status: 'queued',
      dryRun: opts.dryRun === true,
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };
    this.jobs.set(job.jobId, job);
    while (this.jobs.size > JOBS_KEEP) this.jobs.delete(this.jobs.keys().next().value as string);
    setImmediate(() => void this.execute(job, opts));
    return { jobId: job.jobId, status: 'queued', deduped: false };
  }

  /** Estado de un job encolado; `null` si no existe (desconocido o ya expulsado/reiniciado). */
  getJob(jobId: string): RefreshJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  private async execute(job: RefreshJob, opts: { dryRun?: boolean }): Promise<void> {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    try {
      job.result = await this.run({ dryRun: opts.dryRun });
      job.status = 'done';
    } catch (e) {
      job.error = String((e as Error).message ?? e).slice(0, 300);
      job.status = 'failed';
      this.logger.error(`decks-meta-refresh job ${job.jobId} falló: ${job.error}`);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
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
    // §PROV-F4 F4-2: `maxRequests` cuenta GET FÍSICAS (intentos, reintentos y redirects), no llamadas lógicas.
    const budget = new FetchBudget(fetchCfg.maxRequests);

    // [1] ÍNDICE `/decks` (fuente de candidatos, §DECKS-TOP-FUENTE.1). Falla o 0 filas ⇒ fallback a la portada (.4).
    type Candidate = HomeLeader & { archetypeId: string; listId: string | null };
    let source: 'decks' | 'home-fallback' = 'decks';
    let formatCode: string | null = null;
    let indexRows = 0;
    let homeParseable = false;
    let leadersWithListId = 0;
    let candidates: Candidate[] = [];
    try {
      const html = await this.client.fetchDecksIndex(budget);
      urlsFetched.push('decks');
      const idx = parseDecksIndex(html);
      formatCode = idx.formatCode;
      indexRows = idx.rows.length;
      // §DECKS-TOP-FUENTE.13: solo filas con rank entero 1..topN (sin repetir arquetipo), en orden de rank.
      const seenIds = new Set<string>();
      const top = idx.rows
        .filter((r) => sanitizeRank(r.rank, fetchCfg.topN) != null)
        .sort((a, b) => a.rank - b.rank)
        .filter((r) => (seenIds.has(r.archetypeId) ? false : (seenIds.add(r.archetypeId), true)));
      candidates = top.slice(0, fetchCfg.topN).map((r) => ({
        archetypeId: r.archetypeId,
        name: r.name,
        rank: r.rank,
        sharePct: r.sharePct,
        listId: null,
        sourceTournament: null,
        cover: null,
      }));
    } catch (e) {
      errors.push(`decks: ${(e as Error).message}`);
    }

    if (candidates.length === 0) {
      source = 'home-fallback';
      try {
        const html = await this.client.fetchHome(budget);
        urlsFetched.push('home');
        const home = parseHomeIndex(html);
        formatCode = home.formatCode;
        homeParseable = home.totalBlocks > 0;
        leadersWithListId = home.leaders.filter((l) => l.listId != null).length;
        candidates = home.leaders
          .filter((l): l is HomeLeader & { archetypeId: string; listId: string } => l.archetypeId != null && l.listId != null)
          .slice(0, fetchCfg.topN);
      } catch (e) {
        errors.push(`home: ${(e as Error).message}`);
      }
    }
    const formatLabel = buildFormatLabel(formatCode);

    // [3] Por candidato: (en `/decks`) página de arquetipo → listId; luego la lista + parse + match. SECUENCIAL con delay (§1).
    const deckReports: DeckReport[] = [];
    const parsedDecks: ParsedDeck[] = [];
    const seenSlugs = new Set<string>();
    let partial = false; // refresco incompleto (cota de GET agotada): no cuenta para `missedRuns` (§DECKS-TOP-FUENTE.12)
    for (const c0 of candidates) {
      if (budget.remaining <= 0) {
        partial = true;
        this.logger.warn(`decks-meta-refresh: cota dura de ${fetchCfg.maxRequests} GET físicas alcanzada; se detiene el fetch.`);
        break;
      }
      // §DECKS-TOP-FUENTE.14: NFKD→ASCII o `arch-<id>` (nunca vacío). Dos arquetipos con el mismo slug: el de mejor rank
      // conserva el base y el otro lleva el sufijo `-<archetypeId>`.
      let slug = deckSlugFor(c0.name, c0.archetypeId);
      if (seenSlugs.has(slug)) slug = suffixSlug(slug, c0.archetypeId);
      if (!slug || seenSlugs.has(slug)) {
        errors.push(`${c0.archetypeId} (${c0.name ?? '??'}): slug duplicado '${slug}'; se salta`);
        continue;
      }
      let c = c0;
      try {
        if (source === 'decks') {
          if (fetchCfg.delayMs > 0) await this.sleep(fetchCfg.delayMs);
          const page = await this.client.fetchArchetype(c0.archetypeId, budget);
          urlsFetched.push(`decks/${c0.archetypeId}`);
          const first = parseArchetypeFirstList(page);
          if (!first) throw new Error('la página del arquetipo no trae ninguna lista');
          // §DECKS-TOP-FUENTE.11: la portada sale de ESTA misma página (`.picture img.card`), sin GET extra.
          c = { ...c0, listId: first.listId, sourceTournament: first.sourceTournament, cover: parseArchetypeCover(page) };
        }
        const leader = c as HomeLeader & { archetypeId: string; listId: string };
        if (fetchCfg.delayMs > 0) await this.sleep(fetchCfg.delayMs);
        const html = await this.client.fetchDeckList(leader.listId, budget);
        urlsFetched.push(`list/${leader.listId}`);
        const { lines } = parseDeckListHtml(html);
        const matched = await this.matcher.matchLines(lines);
        // Portada (§12.4.2): casada APARTE con el mismo motor; NUNCA se mezcla con `matched` (las 60),
        // así que no cuenta en sumQuantity/matched/total, canario, MetaDeckCard ni no-mapeadas.
        const cover = await this.matchDeckCover(leader, errors);
        const summary = summarize(leader, matched);
        const report = toDeckReport(leader, matched, thresholds.cardsMin, thresholds.cardsMax, cover);
        seenSlugs.add(slug);
        parsedDecks.push({ leader, slug, matched, summary: { ...summary, slug }, cover });
        deckReports.push(report);
      } catch (e) {
        const msg = `${c.listId ? `list/${c.listId}` : `decks/${c.archetypeId}`} (${c.name ?? '??'}): ${(e as Error).message}`;
        errors.push(msg);
        deckReports.push(errorDeckReport(c, (e as Error).message));
        if (e instanceof FetchBudgetExhaustedError) {
          partial = true;
          break; // refresco parcial: mañana se reintenta
        }
      }
    }

    // §DECKS-TOP-FUENTE.5: con `/decks` un deck fuera de banda NO bloquea a los demás (se publica lo que pasa);
    // se excluye de la evaluación y de la persistencia y queda en `errors` y en `decks[].inBand=false`.
    let publishable = parsedDecks;
    let bandTotal: number | undefined;
    if (source === 'decks') {
      bandTotal = parsedDecks.length; // C2 (.16): fuera de banda ≤ 40 % de las filas válidas traídas
      publishable = parsedDecks.filter((p) => p.summary.sumQuantity >= thresholds.cardsMin && p.summary.sumQuantity <= thresholds.cardsMax);
      for (const p of parsedDecks) {
        if (!publishable.includes(p)) errors.push(`${p.leader.name ?? p.leader.archetypeId}: fuera de banda (${p.summary.sumQuantity}); no se publica`);
      }
    }

    // [4] CANARY (en memoria, antes de cualquier escritura).
    const canary = evaluateCanary(
      {
        homeParseable,
        leadersWithListId,
        ...(source === 'decks' ? { indexRows, bandTotal } : {}),
        decks: publishable.map((p) => p.summary),
      },
      thresholds,
    );

    const base: RefreshReport = {
      mode,
      source,
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
      persistedCount: 0,
      publishedSlugs: [],
      delistedSlugs: [],
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
    for (const p of publishable) {
      try {
        const outcome = await this.persistDeck(p, { formatLabel, sourceTournament: p.leader.sourceTournament }, autopublish, fetchCfg.topN);
        if (outcome.slug !== p.slug) p.slug = outcome.slug;
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

    // §DECKS-TOP-FUENTE.12: solo una corrida con índice válido, canario OK y fetch completo cuenta para `missedRuns`.
    if (source === 'decks' && indexRows >= thresholds.minDecks && !partial) {
      try {
        base.delistedSlugs = await this.applyIndexPresence(candidates);
      } catch (e) {
        errors.push(`missedRuns: ${(e as Error).message}`);
      }
    }

    base.applied = true;
    await this.recordRun(base, true);
    base.finishedAt = new Date().toISOString();
    return base;
  }

  /**
   * Casa la portada del arquetipo (si la home la trajo). La portada es PROCEDENCIA, nunca bloquea: un
   * fallo al casarla (p. ej. error de BD en la lectura) se registra y el deck sigue SIN portada (las 4
   * columnas null, invariante todo-null) — no convierte el deck en `error` ni toca el canario, pero
   * el fallo SÍ se añade a `errors` (visible en el reporte y en el `note` del `MetaFetchRun`).
   */
  private async matchDeckCover(leader: HomeLeader, errors: string[]): Promise<DeckCover | null> {
    if (!leader.cover) return null;
    try {
      const m = await this.matcher.matchCover(leader.cover);
      return { setCode: leader.cover.setCode, number: leader.cover.number, matchStatus: m.matchStatus, card: m.card };
    } catch (e) {
      const msg = (e as Error).message;
      // Forma EXACTA del contrato (API_CONTRACT §13 Admin fila 4b): `cover <SET>-<NÚM>: <msg>`. Es el
      // único sitio donde queda el crudo: el reporte da `cover:null` y en vivo las 4 columnas van null.
      errors.push(`cover ${leader.cover.setCode}-${leader.cover.number}: ${msg}`);
      this.logger.warn(`portada ${leader.cover.setCode}-${leader.cover.number} (${leader.name ?? leader.archetypeId}): no se pudo casar (${msg}); el deck sigue sin portada.`);
      return null;
    }
  }

  /**
   * §DECKS-TOP-FUENTE.12: contabilidad de presencia en el índice (solo corridas válidas). Presente en el top N ⇒
   * `missedRuns=0` y `rank` = el del índice (también si su lista falló esta vez). Ausente ⇒ `missedRuns+1` y `rank=null`;
   * al llegar a {@link MISSED_RUNS_LIMIT} ⇒ `published=false`. `source=manual` y `pausedByOperator` no se tocan.
   * Devuelve los slugs despublicados.
   */
  private async applyIndexPresence(candidates: { archetypeId: string; rank: number | null }[]): Promise<string[]> {
    const refs = candidates.map((c) => `/decks/${c.archetypeId}`);
    return this.prisma.$transaction(async (tx) => {
      for (const c of candidates) {
        if (c.rank == null) continue;
        await tx.metaDeck.updateMany({
          where: { source: MetaDeckSource.limitless, pausedByOperator: false, sourceRef: `/decks/${c.archetypeId}` },
          data: { missedRuns: 0, rank: c.rank },
        });
      }
      const absent = { source: MetaDeckSource.limitless, pausedByOperator: false, OR: [{ sourceRef: null }, { sourceRef: { notIn: refs } }] };
      await tx.metaDeck.updateMany({ where: absent, data: { missedRuns: { increment: 1 }, rank: null } });
      const toDelist = await tx.metaDeck.findMany({
        where: { ...absent, missedRuns: { gte: MISSED_RUNS_LIMIT }, published: true },
        select: { id: true, slug: true },
      });
      if (toDelist.length > 0) {
        await tx.metaDeck.updateMany({ where: { id: { in: toDelist.map((d) => d.id) } }, data: { published: false } });
      }
      return toDelist.map((d) => d.slug);
    });
  }

  /**
   * Persiste UN deck en su propia `$transaction` (patrón `adminCreateOrCurate` de Fase 1):
   * upsert deck (source=limitless) → `MetaDeckList` nueva e inmutable → cards → supersede → re-apuntar
   * `currentListId`. Respeta `pausedByOperator` (se salta) y «manual gana» (no pisa `source=manual`).
   */
  private async persistDeck(
    p: ParsedDeck,
    meta: { formatLabel: string; sourceTournament: string | null },
    autopublish: boolean,
    topN: number,
  ): Promise<PersistOutcome> {
    const rank = sanitizeRank(p.leader.rank, topN);
    const ref = `/decks/${p.leader.archetypeId}`;
    if (!p.slug) throw new Error('slug vacío (invariante §DECKS-TOP-FUENTE.14)');
    return this.prisma.$transaction(async (tx) => {
      // Slug estable: el deck que ya existe para este arquetipo conserva el suyo; si no, el base y, ante choque con OTRO
      // arquetipo de Limitless, el sufijo `-<archetypeId>` (§DECKS-TOP-FUENTE.14).
      const byRef = await tx.metaDeck.findFirst({ where: { source: MetaDeckSource.limitless, sourceRef: ref } });
      let slug = byRef?.slug ?? p.slug;
      let existing = byRef ?? (await tx.metaDeck.findUnique({ where: { slug } }));
      if (!byRef && existing && existing.source === MetaDeckSource.limitless && existing.sourceRef != null && existing.sourceRef !== ref) {
        slug = suffixSlug(slug, p.leader.archetypeId);
        existing = await tx.metaDeck.findUnique({ where: { slug } });
      }

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
      // §DECKS-TOP-FUENTE.13: la publicación exige rank ≠ null (el rank resultante es el nuevo o, en su defecto, el previo).
      const resultingRank = rank ?? existing?.rank ?? null;
      const canTurnOn = autopublish && resultingRank != null;
      const willPublish = canTurnOn ? true : existing?.published ?? false;
      // §DECKS-TOP-FUENTE.11: portada nueva de la página del arquetipo; sin portada (o sin casar cuando la vigente sí
      // casó) HEREDA la de la lista vigente. Prohibido pisar una portada existente con null.
      let cover: { setCode: string; number: string; matchStatus: CoverMatch['matchStatus']; cardId: string | null } | null = p.cover
        ? { setCode: p.cover.setCode, number: p.cover.number, matchStatus: p.cover.matchStatus, cardId: p.cover.card?.id ?? null }
        : null;
      if (existing?.currentListId && (!cover || cover.cardId == null)) {
        const prev = await tx.metaDeckList.findUnique({
          where: { id: existing.currentListId },
          select: { coverSetCode: true, coverNumber: true, coverMatchStatus: true, coverCardId: true },
        });
        if (prev?.coverSetCode && prev.coverNumber && prev.coverMatchStatus && (!cover || prev.coverCardId)) {
          cover = { setCode: prev.coverSetCode, number: prev.coverNumber, matchStatus: prev.coverMatchStatus as CoverMatchStatus, cardId: prev.coverCardId };
        }
      }

      const deck = await tx.metaDeck.upsert({
        where: { slug },
        create: {
          slug,
          name: p.leader.name ?? slug,
          source: MetaDeckSource.limitless,
          sourceRef: `/decks/${p.leader.archetypeId}`,
          rank,
          sharePct: p.leader.sharePct ?? null,
          trend,
          published: willPublish,
        },
        update: {
          name: p.leader.name ?? slug,
          source: MetaDeckSource.limitless,
          sourceRef: `/decks/${p.leader.archetypeId}`,
          rank: rank ?? undefined,
          sharePct: p.leader.sharePct ?? undefined,
          trend: trend ?? undefined,
          ...(canTurnOn ? { published: true } : {}),
        },
      });

      const list = await tx.metaDeckList.create({
        data: {
          deckId: deck.id,
          formatLabel: meta.formatLabel,
          // FUENTE-CONFIABLE (SUP-LEG): sin ventana de marcas; se persiste vacío (columna inerte).
          activeMarksSnapshot: [] as unknown as Prisma.InputJsonValue,
          sourceUrl: `https://limitlesstcg.com/decks/list/${p.leader.listId}`,
          sourceTournament: meta.sourceTournament ?? null,
          // Portada (§12.4.3). Invariantes: setCode/number/matchStatus todos null o todos no-null;
          // coverCardId ≠ null ⇒ matchStatus = matched (matchCover sólo devuelve carta si casó).
          coverSetCode: cover?.setCode ?? null,
          coverNumber: cover?.number ?? null,
          coverMatchStatus: cover?.matchStatus ?? null,
          coverCardId: cover?.cardId ?? null,
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
    source: report.source,
    canaryVerdict: report.canary.verdict,
    canaryReason: report.canary.reason,
    persistedCount: report.persistedCount,
    checks: report.canary.checks.map((c) => ({ id: c.id, ok: c.ok, measured: c.measured, threshold: c.threshold })),
    perDeckCounts: capArray(report.decks, NOTE_MAX_ITEMS).map((d) => ({ archetypeId: d.archetypeId, name: d.name, sumQuantity: d.sumQuantity, matched: d.matched, total: d.total })),
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

const JOBS_KEEP = 20;

/** Estado de un «Publicar ahora» encolado (`GET /admin/jobs/decks-meta-refresh/:jobId`). */
export interface RefreshJob {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  dryRun: boolean;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Resultado de `run()` (reporte, o `skipped` con motivo) cuando `status='done'`. */
  result: RefreshRunResult | null;
  /** Mensaje acotado cuando `status='failed'`. */
  error: string | null;
}

interface ParsedDeck {
  /** Slug base de la corrida (§DECKS-TOP-FUENTE.14); `persistDeck` lo resuelve contra la BD y devuelve el definitivo. */
  slug: string;
  leader: HomeLeader & { archetypeId: string; listId: string };
  matched: MatchedLine[];
  summary: DeckCanarySummary;
  /** Portada casada (o `null` si la home no la trajo válida). NO forma parte de `matched`. */
  cover: DeckCover | null;
}

/** Portada del arquetipo: crudo del `alt` + resultado del casado (§12.4.2). */
interface DeckCover {
  setCode: string;
  number: string;
  matchStatus: CoverMatch['matchStatus'];
  card: CoverMatch['card'];
}

/**
 * `decks[].cover` del ensayo (API_CONTRACT §13 Admin, ADITIVO). `imageUrl` = imagen de NUESTRO catálogo
 * (`imageLargeUrl ?? imageSmallUrl`), nunca la de Limitless. Es procedencia: no altera verdict/checks/inBand.
 */
export interface DeckCoverReport {
  setCode: string;
  number: string;
  matchStatus: CoverMatchStatus;
  cardId: string | null;
  imageUrl: string | null;
}

/** §DECKS-TOP-FUENTE.12: corridas válidas seguidas fuera del top N tras las que se despublica un deck. */
export const MISSED_RUNS_LIMIT = 3;

/** Slug con sufijo `-<archetypeId>` (≤120 caracteres). */
export function suffixSlug(slug: string, archetypeId: string): string {
  return `${slug.slice(0, 120 - 1 - archetypeId.length).replace(/-+$/, '')}-${archetypeId}`;
}

/** F4-7: el puesto de Limitless solo vale si es entero 1..topN; si no ⇒ null (el deck queda sin puesto y no pesa en las sugeridas). */
export function sanitizeRank(r: unknown, topN: number): number | null {
  return typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= topN ? r : null;
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
  inBand: boolean;
  /** Portada (rev `decks-portada`). `null` ⇔ la home no trajo portada válida, o la lista falló (`error`). */
  cover: DeckCoverReport | null;
  error?: string;
}

export interface RefreshReport {
  mode: RefreshMode;
  /** §DECKS-TOP-FUENTE: de dónde salieron los candidatos (`home-fallback` ⇒ aviso: `/decks` falló). */
  source: 'decks' | 'home-fallback';
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
  /** Arquetipos EFECTIVAMENTE persistidos este run (lista nueva creada), ni pausados ni manual-gana. */
  persistedCount: number;
  publishedSlugs: string[];
  /** §DECKS-TOP-FUENTE.12: slugs despublicados en esta corrida por llevar {@link MISSED_RUNS_LIMIT} corridas válidas fuera del top. */
  delistedSlugs: string[];
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
    slug: deckSlugFor(leader.name, leader.archetypeId),
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
  cardsMin: number,
  cardsMax: number,
  cover: DeckCover | null,
): DeckReport {
  const breakdown: Record<string, number> = {};
  for (const m of matched) breakdown[m.matchStatus] = (breakdown[m.matchStatus] ?? 0) + 1;
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
    inBand: sumQuantity >= cardsMin && sumQuantity <= cardsMax,
    cover: cover
      ? {
          setCode: cover.setCode,
          number: cover.number,
          matchStatus: cover.matchStatus,
          cardId: cover.card?.id ?? null,
          imageUrl: cover.card ? imageOf(cover.card) : null,
        }
      : null,
  };
}

function errorDeckReport(leader: HomeLeader & { archetypeId: string }, error: string): DeckReport {
  return {
    archetypeId: leader.archetypeId,
    name: leader.name,
    rank: leader.rank,
    sharePct: leader.sharePct,
    listId: leader.listId ?? '',
    cardsParsed: 0,
    sumQuantity: 0,
    matched: 0,
    total: 0,
    matchStatusBreakdown: {},
    inBand: false,
    cover: null,
    error,
  };
}

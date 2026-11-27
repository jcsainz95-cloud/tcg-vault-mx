import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import type { TcgcsvGroupRef } from '../pricing/pricing.types';
import { isSchedulerDisabled } from '../../config/test-env';
import { CardLinkRepairService, LinkRepairSetResult, LINK_REPAIR_GATE_NAMESPACE } from './card-link-repair.service';
import { AUTO_LINK_PRICE_LOCK_KEY } from './auto-link-lock';
import { TcgcsvCallBudget } from './tcgcsv-call-budget';
import { countsInUnlinkedCards, fullyLinkedSets, nextAutoLinkRun, piecesBySet, unlinkedBySet, untryableReason, utcDayStart } from './auto-link-stats';
import { TcgcsvGroupsCache } from './tcgcsv-groups-cache';
import { SANITY_WAIT_DAYS } from '../pricing/auto-link-price-gate.service';
import { FINISH_ADD_RUN_CAP } from './card-product-resolver.service';

/** Topes de UNA tanda (DECISIONES §AUTO-ENLACE 1; contrato §1). */
export const AUTO_LINK_MAX_SETS = 8;
export const AUTO_LINK_MAX_CARDS = 600;
export const AUTO_LINK_MAX_CALLS = 40;
export const AUTO_LINK_MAX_MS = 30 * 60_000;
/** §10.2: sets ya ligados que se reconcilian (acabados) por corrida, tras la tanda principal y con los mismos topes. */
export const AUTO_LINK_SWEEP_SETS = 10;
/** Espera tras un intento sin progreso: 1, 3, 7, 7… días. */
export const AUTO_LINK_BACKOFF_DAYS = [1, 3, 7] as const;

const ACTION = 'catalog.auto_link';
const RUN_ACTION = 'catalog.auto_link_run';
const CLAIM = 'catalog.auto_link_claim';

export interface AutoLinkRunResult {
  ran: boolean;
  skipped?: 'dial_off' | 'lock_taken' | 'nothing_to_retry' | 'scheduler_disabled';
  setsTried: number;
  linked: number;
  priced: number;
  remainingBefore: number;
  remainingAfter: number;
  tcgcsvCalls: number;
  durationMs: number;
  aborted?: string;
  /** §9.6 (iii): id de la corrida (liga la fila `auto_link_run` con las filas `auto_link` de sus sets). */
  runId?: string;
  held?: number;
  /** §10.2: sets ya ligados reconciliados en esta corrida (no cuentan en `setsTried`). */
  swept?: number;
  sets: { setId: string; linked: number; priced: number; reason: string | null; held?: number; finishesAdded?: number; sweep?: true; error?: string }[];
}

export interface AutoLinkRunOptions {
  trigger?: 'cron' | 'retry' | 'manual';
  /** Pruebas: fija topes/espera/reloj sin tocar las constantes. */
  maxSets?: number;
  maxCards?: number;
  maxCalls?: number;
  maxMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  /** Pruebas: limita la tanda (y el barrido) a estos sets; la lista se lee en cada corrida. */
  onlySetIds?: readonly string[];
}

/** Racha de intentos sin progreso → días de espera (1, 3, 7, 7…). `previousStreak` = intentos SIN progreso inmediatamente anteriores. */
export function backoffDays(previousStreak: number): number {
  return AUTO_LINK_BACKOFF_DAYS[Math.min(previousStreak, AUTO_LINK_BACKOFF_DAYS.length - 1)];
}

/** Dial `auto_link_enabled` (nace `on`; super_admin lo apaga). Sin servicio de ajustes o con lectura fallida ⇒ apagado (dinero ante la duda). */
export async function autoLinkEnabled(settings?: Pick<SettingsService, 'getString'>): Promise<boolean> {
  if (!settings) return false;
  try {
    return (await settings.getString(SettingKey.AUTO_LINK_ENABLED)) === 'on';
  } catch {
    return false;
  }
}

/**
 * §AUTO-ENLACE fase 2 — `catalog-auto-link`: una tanda diaria (05:00 UTC) que, por set, resuelve el grupo, liga, precia (B4) y
 * corrige piezas, con los MISMOS cuerpos que el botón «Actualizar este set» (`CardLinkRepairService.attemptSetAuto`).
 *  - Candado: `pg_try_advisory_xact_lock` EXCLUSIVO toda la corrida (misma llave que consulta `price-ingest`); tomado ⇒ se salta (reintento 09:30 una vez).
 *  - 1 reclamo por (set, día UTC) bajo `pg_advisory_xact_lock`; segunda corrida el mismo día o sobre el mismo estado = 0 escrituras.
 *  - Sin progreso ⇒ espera 1/3/7/7… días (`nextAttemptAt`); fallo de proveedor ⇒ 0 escrituras del set y mañana; 3 llamadas fallidas seguidas ⇒ se aborta.
 *  - Auditoría `catalog.auto_link` por set y `catalog.auto_link_run` por corrida (`actorUserId=null`).
 */
@Injectable()
export class CatalogAutoLinkService {
  private readonly logger = new Logger(CatalogAutoLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly repair: CardLinkRepairService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly groupsCache: TcgcsvGroupsCache,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  async run(opts: AutoLinkRunOptions = {}): Promise<AutoLinkRunResult> {
    const blank = (skipped: AutoLinkRunResult['skipped']): AutoLinkRunResult => ({
      ran: false, skipped, setsTried: 0, linked: 0, priced: 0, remainingBefore: 0, remainingAfter: 0, tcgcsvCalls: 0, durationMs: 0, sets: [],
    });
    if (!(await autoLinkEnabled(this.settings))) {
      this.logger.log('catalog-auto-link: dial auto_link_enabled=off; no se hace nada.');
      return blank('dial_off');
    }
    if (opts.trigger === 'retry' && !(await this.lockSkippedToday())) return blank('nothing_to_retry');

    // El candado vive en una transacción que se mantiene abierta toda la corrida (precedente: graded-turns, price-ingest.service).
    // El trabajo usa el cliente normal (otras conexiones); la transacción solo sostiene el candado y se libera sola al terminar o caer.
    const timeout = (opts.maxMs ?? AUTO_LINK_MAX_MS) + 5 * 60_000;
    return this.prisma.$transaction(
      async (lockTx) => {
        const [{ locked }] = await lockTx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${AUTO_LINK_PRICE_LOCK_KEY}::bigint) AS locked`;
        if (!locked) {
          await this.audit.log({ actorUserId: null, action: RUN_ACTION, entityType: 'CardSet', after: { setsTried: 0, linked: 0, priced: 0, remainingBefore: 0, remainingAfter: 0, tcgcsvCalls: 0, durationMs: 0, aborted: 'lock_taken', trigger: opts.trigger ?? 'cron' } });
          this.logger.warn('catalog-auto-link: candado tomado (price-ingest u otra corrida); se salta.');
          return blank('lock_taken');
        }
        return this.runLocked(opts);
      },
      { timeout, maxWait: 10_000 },
    );
  }

  /** ¿La corrida de hoy se saltó por candado tomado y no hubo otra completa? (condición del reintento de las 09:30). */
  private async lockSkippedToday(): Promise<boolean> {
    const rows = await this.prisma.auditLog.findMany({ where: { action: RUN_ACTION, createdAt: { gte: utcDayStart() } }, select: { after: true } });
    if (rows.length === 0) return false;
    return rows.every((r) => (r.after as { aborted?: string } | null)?.aborted === 'lock_taken');
  }

  private async runLocked(opts: AutoLinkRunOptions): Promise<AutoLinkRunResult> {
    const now = opts.now ?? Date.now;
    const started = now();
    const maxMs = opts.maxMs ?? AUTO_LINK_MAX_MS;
    const budget = new TcgcsvCallBudget({ max: opts.maxCalls ?? AUTO_LINK_MAX_CALLS, retryDelayMs: opts.retryDelayMs, deadlineAt: started + maxMs, now });
    const runId = randomUUID();
    const finishBudget = { remaining: FINISH_ADD_RUN_CAP };
    const out: AutoLinkRunResult = { ran: true, runId, held: 0, swept: 0, setsTried: 0, linked: 0, priced: 0, remainingBefore: 0, remainingAfter: 0, tcgcsvCalls: 0, durationMs: 0, sets: [] };
    const finish = async (aborted?: string): Promise<AutoLinkRunResult> => {
      out.remainingAfter = await this.remainingUnlinked();
      out.tcgcsvCalls = budget.used;
      out.durationMs = now() - started;
      if (aborted) out.aborted = aborted;
      await this.audit.log({
        actorUserId: null, action: RUN_ACTION, entityType: 'CardSet',
        after: { setsTried: out.setsTried, linked: out.linked, priced: out.priced, remainingBefore: out.remainingBefore, remainingAfter: out.remainingAfter, tcgcsvCalls: out.tcgcsvCalls, durationMs: out.durationMs, trigger: opts.trigger ?? 'cron', runId, held: out.held ?? 0, swept: out.swept ?? 0, ...(aborted ? { aborted } : {}) },
      });
      this.logger.log(`catalog-auto-link: sets=${out.setsTried} ligadas=${out.linked} con precio=${out.priced} quedan ${out.remainingBefore}→${out.remainingAfter} llamadas=${out.tcgcsvCalls} ${out.durationMs}ms${aborted ? ` ABORTADA(${aborted})` : ''}.`);
      return out;
    };

    out.remainingBefore = await this.remainingUnlinked();
    const order = await this.pickSets(opts.maxSets ?? AUTO_LINK_MAX_SETS, new Date(), opts.onlySetIds);
    const sweep = await this.pickSweepSets(AUTO_LINK_SWEEP_SETS, opts.onlySetIds);
    if (order.length === 0 && sweep.length === 0) return finish();

    // `listGroups`: 1 por corrida (cuenta en el tope); sirve a todos los sets de la tanda y llena el caché de 24 h de la lista de excepciones.
    let groups: TcgcsvGroupRef[];
    try {
      groups = await budget.call(() => this.tcgcsv.listGroups());
      this.groupsCache.put(groups);
    } catch (e) {
      this.logger.warn(`catalog-auto-link: listGroups falló (${(e as Error).name}); la corrida se aborta y mañana sigue.`);
      return finish('provider_failing');
    }

    let linkedSoFar = 0;
    for (const s of order) {
      if (budget.tripped) return finish('circuit_open');
      if (now() - started >= maxMs) return finish('time');
      if (linkedSoFar >= (opts.maxCards ?? AUTO_LINK_MAX_CARDS)) return finish('card_cap');
      if (budget.remaining < 2) return finish('call_cap'); // un set = productos + precios
      if (!(await this.claim(s.setId))) continue; // ya intentado hoy
      const r = await this.repair.attemptSetAuto(s.setId, { budget, groups, maxLinks: (opts.maxCards ?? AUTO_LINK_MAX_CARDS) - linkedSoFar, finishBudget });
      out.setsTried += 1;
      out.linked += r.linked;
      out.priced += r.priced;
      linkedSoFar += r.linked;
      out.held = (out.held ?? 0) + r.held;
      out.sets.push({ setId: s.setId, linked: r.linked, priced: r.priced, reason: r.reason, held: r.held, finishesAdded: r.finishesAdded, ...(r.error ? { error: r.error } : {}) });
      await this.recordSet(s.setId, r, s.previousNoProgress, now(), runId);
    }

    // §10.2: tras la tanda principal (que tiene prioridad) y con los MISMOS topes, hasta 10 sets ya ligados rotan por su último barrido de acabados.
    for (const s of sweep) {
      if (budget.tripped) return finish('circuit_open');
      if (now() - started >= maxMs) return finish('time');
      if (budget.remaining < 2) return finish('call_cap');
      if (finishBudget.remaining <= 0) break; // sin cupo de acabados no hay nada que reconciliar hoy
      if (!(await this.claim(s.setId))) continue;
      const r = await this.repair.attemptSetAuto(s.setId, { budget, groups, maxLinks: 0, finishBudget });
      out.swept = (out.swept ?? 0) + 1;
      out.priced += r.priced;
      out.held = (out.held ?? 0) + r.held;
      out.sets.push({ setId: s.setId, linked: 0, priced: r.priced, reason: r.reason, held: r.held, finishesAdded: r.finishesAdded, sweep: true, ...(r.error ? { error: r.error } : {}) });
      if (!r.error) await this.recordSweep(s.setId, r, runId);
    }
    return finish(budget.tripped ? 'circuit_open' : undefined);
  }

  /**
   * §10.2 — sets 100 % ligados por la fecha más antigua de su último barrido (`catalog.auto_link`, con o sin `sweep`; un set sin barrido previo es el más
   * antiguo). Los sets que el job ya reclamó hoy no vuelven a salir (el reclamo por set y día manda).
   */
  async pickSweepSets(limit: number, onlySetIds?: readonly string[]): Promise<{ setId: string }[]> {
    const only = onlySetIds ? new Set(onlySetIds) : null;
    const rows = (await fullyLinkedSets(this.prisma)).filter((r) => untryableReason(r) === null && (!only || only.has(r.setId)));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.setId);
    const [lastRows, claims] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['entityId'], where: { action: ACTION, entityId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.auditLog.findMany({ where: { action: CLAIM, createdAt: { gte: utcDayStart() }, entityId: { in: ids } }, select: { entityId: true } }),
    ]);
    const last = new Map(lastRows.map((r) => [r.entityId, r._max.createdAt?.getTime() ?? -1]));
    const claimed = new Set(claims.map((c) => c.entityId));
    return rows
      .filter((r) => !claimed.has(r.setId))
      .sort((a, b) => (last.get(a.setId) ?? -1) - (last.get(b.setId) ?? -1) || (a.setId < b.setId ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({ setId: r.setId }));
  }

  /** Auditoría del barrido (rota el set aunque no haya cambios): sin racha ni espera del job (`noProgress:false`). */
  private async recordSweep(setId: string, r: LinkRepairSetResult, runId: string): Promise<void> {
    await this.audit.log({
      actorUserId: null,
      action: ACTION,
      entityType: 'CardSet',
      entityId: setId,
      after: {
        setId, sweep: true, runId, groupId: r.groupUsed?.groupId ?? null, via: r.groupUsed?.via ?? null, groupName: r.groupUsed?.name ?? null,
        linked: 0, priced: r.priced, held: r.held, finishesAdded: r.finishesAdded, omitted: r.omitted, reason: r.reason, noProgress: false, nextAttemptAt: null, tries: 0,
        linkedCardIds: [], sample: r.samples,
        ...(r.b3Retained ? { b3Retained: r.b3Retained, b3Sample: r.b3Sample } : {}),
      },
    });
  }

  /** Cartas sin ligar de sets que el job puede tocar (promos/`tcgcsv:`/«no está en el proveedor» salen aparte). */
  private async remainingUnlinked(): Promise<number> {
    return (await unlinkedBySet(this.prisma)).filter((s) => countsInUnlinkedCards(s)).reduce((n, s) => n + s.unlinked, 0);
  }

  /**
   * Prioridad (DECISIONES §AUTO-ENLACE 1): (1) sets con piezas a la venta o en revisión de precio sobre cartas sin ligar, por nº de piezas desc;
   * (2) más cartas sin ligar; (3) intento más antiguo. Excluye promos/`tcgcsv:`/no-proveedor, sets en espera y los ya reclamados hoy.
   */
  async pickSets(limit: number, at = new Date(), onlySetIds?: readonly string[]): Promise<{ setId: string; unlinked: number; pieces: number; previousNoProgress: number }[]> {
    const only = onlySetIds ? new Set(onlySetIds) : null;
    const rows = (await unlinkedBySet(this.prisma)).filter((s) => untryableReason(s) === null && (!only || only.has(s.setId)));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.setId);
    const [pc, attempts, claims] = await Promise.all([
      piecesBySet(this.prisma),
      this.prisma.auditLog.findMany({ where: { action: { in: [ACTION, 'catalog.auto_unlink'] }, entityId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { entityId: true, createdAt: true, after: true }, take: 20_000 }),
      this.prisma.auditLog.findMany({ where: { action: CLAIM, createdAt: { gte: utcDayStart(at) }, entityId: { in: ids } }, select: { entityId: true } }),
    ]);
    const lastAt = new Map<string, number>();
    const streak = new Map<string, number>();
    const nextAt = new Map<string, number>();
    const closed = new Set<string>();
    for (const a of attempts) {
      if (!a.entityId) continue;
      const after = (a.after ?? {}) as { noProgress?: unknown; nextAttemptAt?: unknown };
      if (!lastAt.has(a.entityId)) {
        lastAt.set(a.entityId, a.createdAt.getTime());
        if (typeof after.nextAttemptAt === 'string') nextAt.set(a.entityId, Date.parse(after.nextAttemptAt));
      }
      if (closed.has(a.entityId)) continue;
      if (after.noProgress === true) streak.set(a.entityId, (streak.get(a.entityId) ?? 0) + 1);
      else closed.add(a.entityId);
    }
    const claimed = new Set(claims.map((c) => c.entityId));
    return rows
      .filter((r) => !claimed.has(r.setId) && !((nextAt.get(r.setId) ?? 0) > at.getTime()))
      .map((r) => ({ setId: r.setId, unlinked: r.unlinked, pieces: pc.get(r.setId) ?? 0, previousNoProgress: streak.get(r.setId) ?? 0 }))
      .sort((a, b) => {
        const pa = a.pieces > 0 ? 1 : 0;
        const pb = b.pieces > 0 ? 1 : 0;
        return pb - pa || b.pieces - a.pieces || b.unlinked - a.unlinked || (lastAt.get(a.setId) ?? -1) - (lastAt.get(b.setId) ?? -1);
      })
      .slice(0, limit);
  }

  /** 1 reclamo por (set, día UTC): `pg_advisory_xact_lock` + consulta; `false` si ya hay uno de hoy. */
  private async claim(setId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINK_REPAIR_GATE_NAMESPACE}::int, hashtext(${'auto:' + setId}))`;
      const today = await tx.auditLog.findFirst({ where: { action: CLAIM, entityId: setId, createdAt: { gte: utcDayStart() } }, select: { id: true } });
      if (today) return false;
      await tx.auditLog.create({ data: { actorUserId: null, action: CLAIM, entityType: 'CardSet', entityId: setId, after: { setId } } });
      return true;
    });
  }

  private async recordSet(setId: string, r: LinkRepairSetResult, previousNoProgress: number, nowMs: number, runId?: string): Promise<void> {
    const progress = r.linked > 0 || r.priced > 0 || r.finishesAdded > 0;
    const noProgress = !r.error && !progress;
    // §9.6 (ii): un set frenado por cordura espera 7 días (grupo equivocado: reintentar mañana daría el mismo resultado).
    // §10.1: `b3_unverified` tampoco se reintenta (el dato no cambia hasta que el dueño confirme): misma espera de 7 días, aunque el job SÍ ligó.
    const waitsLong = r.reason === 'price_sanity' || r.reason === 'b3_unverified';
    const waitDays = waitsLong ? SANITY_WAIT_DAYS : backoffDays(previousNoProgress);
    const nextAttemptAt = noProgress || r.reason === 'b3_unverified' ? new Date(utcDayStart(new Date(nowMs)).getTime() + waitDays * 86_400_000).toISOString() : null;
    await this.audit.log({
      actorUserId: null,
      action: ACTION,
      entityType: 'CardSet',
      entityId: setId,
      after: {
        setId, groupId: r.groupUsed?.groupId ?? null, via: r.groupUsed?.via ?? null, groupName: r.groupUsed?.name ?? null,
        linked: r.linked, priced: r.priced, collisions: r.collisions, conflicts: r.conflicts, omitted: r.omitted, notLinkable: r.notLinkable,
        reason: r.reason, noProgress, nextAttemptAt, tries: noProgress ? previousNoProgress + 1 : 0,
        ...(runId ? { runId } : {}), held: r.held, finishesAdded: r.finishesAdded, ...(r.sanity ? { sanity: r.sanity } : {}),
        linkedCardIds: r.linkedCardIds, sample: r.samples,
        ...(r.candidates?.length ? { candidates: r.candidates } : {}),
        ...(r.b3Retained ? { b3Retained: r.b3Retained, b3Sample: r.b3Sample } : {}),
        reviewable: r.reviewable ?? 0, noSourceProduct: r.noSourceProduct ?? 0,
        ...(r.error ? { error: r.error } : {}),
      },
    });
  }

  /** Fecha de la próxima corrida diaria para el contador. */
  nextRunAt(): Date {
    return nextAutoLinkRun();
  }

  /** Cron de las 05:00 y reintento de las 09:30. No hace nada con el planificador apagado (pruebas). */
  async tick(trigger: 'cron' | 'retry'): Promise<AutoLinkRunResult> {
    if (isSchedulerDisabled()) return { ran: false, skipped: 'scheduler_disabled', setsTried: 0, linked: 0, priced: 0, remainingBefore: 0, remainingAfter: 0, tcgcsvCalls: 0, durationMs: 0, sets: [] };
    return this.run({ trigger });
  }
}

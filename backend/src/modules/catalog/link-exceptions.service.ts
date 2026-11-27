import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { promoGroupFor } from './promo-set-groups';
import { autoLinkEnabled } from './catalog-auto-link.service';
import { CardLinkRepairService, LINK_REPAIR_GATE_NAMESPACE, LINK_REPAIR_MANUAL_COOLDOWN_MS, LinkExceptionReason } from './card-link-repair.service';
import { countsInUnlinkedCards, nextAutoLinkRun, piecesBySet, unlinkedBySet, untryableReason, utcDayStart } from './auto-link-stats';
import { TcgcsvGroupsCache } from './tcgcsv-groups-cache';
import { scoreGroupCandidates, type GroupCandidate } from '../pricing/providers/tcgcsv-group-match';
import { FinishReviewService } from './finish-review.service';
import { safeErrorTag } from '../shipments/guest-mail-link';

/** Contrato §8c `AutoLinkSummary` (idéntico en `link-exceptions.summary` y `sync-status.autoLink`). */
export interface LinkSummary {
  autoLinkEnabled: boolean;
  unlinkedCards: number;
  unlinkedSets: number;
  repairedYesterday: number;
  pricedYesterday: number;
  lastRunAt: string | null;
  /** `null` con el dial apagado. */
  nextRunAt: string | null;
  waitingDecision: number;
  /** = `finish-review.pending` (piezas antiguas por confirmar, fase 4). */
  pendingConfirm: number;
}

export interface LinkExceptionSet {
  setId: string;
  name: string;
  unlinked: number;
  total: number;
  reason: LinkExceptionReason;
  groupUsed: { groupId: number; name: string | null; via: 'auto' | 'confirmed' | 'promo_table' } | null;
  candidates: GroupCandidate[];
  canConfirm: boolean;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  tries: number;
}

export interface ConfirmResult {
  setId: string;
  groupUsed: { groupId: number; name: string | null; via: 'confirmed' };
  linked: number;
  priced: number;
  collisions: number;
  conflicts: number;
  omitted: { reason: string; count: number }[];
  examples: { cardId: string | null; number: string | null; reason: string }[];
}

const CONFIRM_CLAIM = 'catalog.group_confirm_claim';

type LastAttempt = { createdAt: Date; action: string; after: Record<string, unknown> };

/**
 * §AUTO-ENLACE fases 2-3 — lista única de excepciones y confirmación de grupo (contrato §2, §3, §8c).
 * Lectura: solo base local (0 llamadas a proveedores; los candidatos salen de la bitácora o del `listGroups` cacheado ≤ 24 h).
 */
@Injectable()
export class LinkExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly repair: CardLinkRepairService,
    private readonly groupsCache: TcgcsvGroupsCache,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly finishReview?: FinishReviewService,
  ) {}

  /** `summary` del contrato: «quedan X · ayer Y (Z con precio)». «Ayer» = día UTC anterior, de las filas `catalog.auto_link_run`. */
  async summary(now = new Date()): Promise<LinkSummary> {
    const today = utcDayStart(now);
    const yesterday = new Date(today.getTime() - 86_400_000);
    const [sets, runs, last, enabled, pendingConfirm] = await Promise.all([
      unlinkedBySet(this.prisma),
      this.prisma.auditLog.findMany({ where: { action: 'catalog.auto_link_run', createdAt: { gte: yesterday, lt: today } }, select: { after: true } }),
      this.prisma.auditLog.findFirst({ where: { action: 'catalog.auto_link_run' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      autoLinkEnabled(this.settings),
      this.finishReview ? this.finishReview.pendingCount().catch(() => 0) : Promise.resolve(0),
    ]);
    const counted = sets.filter((s) => countsInUnlinkedCards(s));
    const sum = (k: 'linked' | 'priced'): number => runs.reduce((n, r) => n + (Number((r.after as Record<string, unknown> | null)?.[k]) || 0), 0);
    return {
      autoLinkEnabled: enabled,
      unlinkedCards: counted.reduce((n, s) => n + s.unlinked, 0),
      unlinkedSets: counted.length,
      repairedYesterday: sum('linked'),
      pricedYesterday: sum('priced'),
      lastRunAt: last?.createdAt.toISOString() ?? null,
      nextRunAt: enabled ? nextAutoLinkRun(now).toISOString() : null,
      waitingDecision: 0,
      pendingConfirm,
    };
  }

  /** Último intento por set (el más nuevo entre `catalog.auto_link` y `catalog.link_repair`) y el último `auto_link` (espera/tries). `DISTINCT ON` parametrizado. */
  private async lastAttempts(ids: string[]): Promise<{ last: Map<string, LastAttempt>; auto: Map<string, LastAttempt> }> {
    const last = new Map<string, LastAttempt>();
    const auto = new Map<string, LastAttempt>();
    if (ids.length === 0) return { last, auto };
    const rows = await this.prisma.$queryRaw<{ entityId: string; action: string; createdAt: Date; after: unknown }[]>`
      SELECT DISTINCT ON ("entityId", "action") "entityId", "action", "createdAt", "after"
      FROM "AuditLog"
      WHERE "action" IN ('catalog.auto_link', 'catalog.link_repair', 'catalog.group_confirmed') AND "entityId" = ANY(${ids}::text[])
      ORDER BY "entityId", "action", "createdAt" DESC`;
    for (const r of rows) {
      const a: LastAttempt = { createdAt: r.createdAt, action: r.action, after: (r.after ?? {}) as Record<string, unknown> };
      if (r.action === 'catalog.auto_link') auto.set(r.entityId, a);
      if (r.action === 'catalog.group_confirmed') continue;
      const cur = last.get(r.entityId);
      if (!cur || cur.createdAt < a.createdAt) last.set(r.entityId, a);
    }
    return { last, auto };
  }

  /** `GET /admin/catalog/link-exceptions`. Orden: con piezas a la venta/en revisión primero, luego `unlinked` desc. */
  async list(now = new Date()): Promise<{ summary: LinkSummary; sets: LinkExceptionSet[] }> {
    const [summary, rows, pieces] = await Promise.all([this.summary(now), unlinkedBySet(this.prisma), piecesBySet(this.prisma)]);
    const setMeta = await this.prisma.cardSet.findMany({
      where: { id: { in: rows.map((r) => r.setId) } },
      select: { id: true, series: true, releaseDate: true, cardGroupId: true, cardGroupVia: true },
    });
    const meta = new Map(setMeta.map((m) => [m.id, m]));
    const { last, auto } = await this.lastAttempts(rows.map((r) => r.setId));
    const groups = this.groupsCache.peek();
    const nameOfGroup = (id: number): string | null => groups?.find((g) => g.groupId === id)?.name ?? null;
    const nextRun = summary.nextRunAt;
    const out: LinkExceptionSet[] = [];
    for (const r of rows) {
      const fixed = untryableReason(r);
      const la = last.get(r.setId);
      const au = auto.get(r.setId);
      const m = meta.get(r.setId);
      let reason: LinkExceptionReason | null = fixed;
      let groupUsed: LinkExceptionSet['groupUsed'] = null;
      let candidates: GroupCandidate[] = [];
      if (fixed === 'promo_route') {
        const p = promoGroupFor(r.externalId)!;
        groupUsed = { groupId: p.groupId, name: null, via: 'promo_table' };
      } else if (!fixed) {
        const a = la?.after ?? {};
        const gu = a.groupUsed as { groupId?: number; name?: string | null; via?: 'auto' | 'confirmed' | 'promo_table' } | null | undefined;
        if (gu && typeof gu.groupId === 'number' && gu.via) groupUsed = { groupId: gu.groupId, name: gu.name ?? nameOfGroup(gu.groupId), via: gu.via };
        else if (m?.cardGroupId != null) groupUsed = { groupId: m.cardGroupId, name: nameOfGroup(m.cardGroupId), via: m.cardGroupVia === 'confirmed' ? 'confirmed' : 'auto' };
        const stored = a.candidates as GroupCandidate[] | undefined;
        if (la) {
          if (a.failed === true) reason = 'provider_failing';
          else if (typeof a.reason === 'string') reason = a.reason as LinkExceptionReason;
          else if ((Number(a.collisions) || 0) > 0) reason = 'collisions';
          else reason = 'name_mismatch'; // intento limpio y siguen cartas sin ligar: la fuente no trae producto con ese nombre/número
          if (reason === 'group_ambiguous' || reason === 'group_none') candidates = stored?.length ? stored : groups && m ? scoreGroupCandidates({ name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId }, groups) : [];
        } else if (groups && m) {
          // Nunca intentado: solo es excepción si ya se sabe que no resolverá grupo (cálculo local sobre el `listGroups` cacheado).
          const c = scoreGroupCandidates({ name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId }, groups);
          if (m.cardGroupId == null && c.length === 0) {
            reason = 'group_none';
          } else continue; // pendiente de su primer intento: lo trata el job (cuenta en `unlinkedCards`, no es excepción)
        } else continue;
      }
      if (!reason) continue;
      const nextAttempt = au && typeof au.after.nextAttemptAt === 'string' ? (au.after.nextAttemptAt as string) : null;
      out.push({
        setId: r.setId, name: r.name, unlinked: r.unlinked, total: r.total, reason, groupUsed, candidates,
        canConfirm: reason === 'group_ambiguous' || reason === 'group_none',
        lastAttemptAt: la?.createdAt.toISOString() ?? null,
        nextAttemptAt: fixed ? null : nextAttempt && Date.parse(nextAttempt) > now.getTime() ? nextAttempt : summary.autoLinkEnabled ? nextRun : null,
        tries: Number(au?.after.tries) || 0,
      });
    }
    out.sort((a, b) => ((pieces.get(b.setId) ?? 0) > 0 ? 1 : 0) - ((pieces.get(a.setId) ?? 0) > 0 ? 1 : 0) || b.unlinked - a.unlinked);
    return { summary, sets: out };
  }

  /**
   * `POST /admin/catalog/link-exceptions/:setId/confirm` — persiste el grupo elegido por el dueño (`cardGroupVia='confirmed'`; el job NUNCA lo pisa),
   * liga y precia el set en la misma llamada. 404 set · 422 `GROUP_NOT_FOUND` · 429 (1 por set cada 10 min) · 503 `UPSTREAM_ERROR` (no persiste nada).
   */
  async confirm(setId: string, groupId: number, user: { id: string; role: Role }): Promise<ConfirmResult> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId }, select: { id: true, cardGroupId: true, cardGroupVia: true, externalId: true } });
    if (!set) throw BusinessException.notFound();
    // El grupo debe existir en `listGroups` (no hace falta que sea candidato): caché ≤ 24 h; si no está, UNA relectura antes de decir que no existe.
    let groups;
    try {
      groups = await this.groupsCache.get();
      if (!groups.some((g) => g.groupId === groupId)) groups = await this.groupsCache.refresh();
    } catch (e) {
      throw this.upstream(setId, e);
    }
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) throw BusinessException.validation('GROUP_NOT_FOUND', 'That TCGCSV group does not exist', { setId, groupId });

    // 1 confirmación por set cada 10 min (reclamo bajo candado consultivo; un fallo del proveedor devuelve el cupo).
    const now = Date.now();
    let claimId = '';
    const wait = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINK_REPAIR_GATE_NAMESPACE}::int, hashtext(${'confirm:' + setId}))`;
      const prev = await tx.auditLog.findFirst({ where: { action: CONFIRM_CLAIM, entityId: setId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (prev && now - prev.createdAt.getTime() < LINK_REPAIR_MANUAL_COOLDOWN_MS) return LINK_REPAIR_MANUAL_COOLDOWN_MS - (now - prev.createdAt.getTime());
      claimId = (await tx.auditLog.create({ data: { actorUserId: user.id, action: CONFIRM_CLAIM, entityType: 'CardSet', entityId: setId, after: { setId } }, select: { id: true } })).id;
      return 0;
    });
    if (wait > 0) {
      throw new BusinessException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'This set was confirmed a moment ago', { retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) });
    }

    const before = { groupId: set.cardGroupId, via: set.cardGroupVia };
    await this.prisma.cardSet.update({ where: { id: setId }, data: { cardGroupId: groupId, cardGroupVia: 'confirmed' } });
    const r = await this.repair.attemptSetConfirmed(setId, user.id, groups);
    if (r.error) {
      // «No persiste nada»: se devuelve la elección anterior y el cupo.
      await this.prisma.cardSet.update({ where: { id: setId }, data: { cardGroupId: before.groupId, cardGroupVia: before.via } });
      await this.prisma.auditLog.deleteMany({ where: { id: claimId } }).catch(() => undefined);
      throw this.upstream(setId, new Error(r.error));
    }
    await this.audit.log({
      actorUserId: user.id, actorRole: user.role, action: 'catalog.group_confirmed', entityType: 'CardSet', entityId: setId,
      before, after: { groupId, via: 'confirmed', linked: r.linked, priced: r.priced },
    });
    // La confirmación reinicia la espera 1/3/7 del job para este set (progreso o no, hubo una decisión humana nueva).
    await this.audit.log({ actorUserId: null, action: 'catalog.auto_link', entityType: 'CardSet', entityId: setId, after: { setId, groupId, via: 'confirmed', linked: r.linked, priced: r.priced, reason: r.reason, noProgress: false, nextAttemptAt: null, tries: 0, trigger: 'confirm' } });
    return {
      setId,
      groupUsed: { groupId, name: group.name, via: 'confirmed' },
      linked: r.linked, priced: r.priced, collisions: r.collisions, conflicts: r.conflicts, omitted: r.omitted, examples: r.examples.slice(0, 20),
    };
  }

  /** AE-4: mensaje fijo al cliente; el detalle solo en la etiqueta del log del llamador (nunca el texto crudo del proveedor). */
  private upstream(setId: string, e: unknown): BusinessException {
    void safeErrorTag(e);
    return BusinessException.retriable('UPSTREAM_ERROR', 'The price provider failed; try again later', { setId });
  }
}

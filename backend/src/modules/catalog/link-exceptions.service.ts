import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { promoGroupFor } from './promo-set-groups';
import { autoLinkEnabled } from './catalog-auto-link.service';
import { CardLinkRepairService, LINK_REPAIR_GATE_NAMESPACE, LINK_REPAIR_MANUAL_COOLDOWN_MS, LinkExceptionReason } from './card-link-repair.service';
import { countsInUnlinkedCards, nextAutoLinkRun, piecesBySet, unlinkedBySet, untryableReason, utcDayStart, type UnlinkedSetRow } from './auto-link-stats';
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
  groupUsed: { groupId: number; name: string | null; via: 'auto' | 'b3' | 'confirmed' | 'promo_table' } | null;
  candidates: GroupCandidate[];
  /** §10.1 `b3_unverified`: ≤ 5 precios retenidos (mercado, sin margen ni IVA) para que el dueño juzgue el grupo. */
  sample?: { cardName: string; number: string; finish: string; newPriceCents: number }[];
  /** §10.4: cartas con candidato (botón «Revisar N cartas») y cartas sin producto en la fuente (informativo); de la última pasada, 0 si aún no se mide. */
  reviewable: number;
  noSourceProduct: number;
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
      WHERE "action" IN ('catalog.auto_link', 'catalog.link_repair', 'catalog.group_confirmed', 'catalog.auto_unlink') AND "entityId" = ANY(${ids}::text[])
      ORDER BY "entityId", "action", "createdAt" DESC`;
    for (const r of rows) {
      const a: LastAttempt = { createdAt: r.createdAt, action: r.action, after: (r.after ?? {}) as Record<string, unknown> };
      if (r.action === 'catalog.auto_link' || r.action === 'catalog.auto_unlink') {
        const cur0 = auto.get(r.entityId);
        if (!cur0 || cur0.createdAt < a.createdAt) auto.set(r.entityId, a); // la cuarentena de `unlink` manda sobre el último intento del job
      }
      if (r.action === 'catalog.group_confirmed') continue;
      const cur = last.get(r.entityId);
      if (!cur || cur.createdAt < a.createdAt) last.set(r.entityId, a);
    }
    return { last, auto };
  }

  /** Sets con grupo B3 aún sin confirmar cuyo último intento retuvo variantes (`b3_unverified`) y que NO están ya en la lista por cartas sin ligar. */
  private async b3PendingRows(already: ReadonlySet<string>): Promise<UnlinkedSetRow[]> {
    const sets = await this.prisma.cardSet.findMany({ where: { cardGroupVia: 'auto' }, select: { id: true, name: true, externalId: true } });
    const cand = sets.filter((x) => !already.has(x.id) && untryableReason(x) === null);
    if (cand.length === 0) return [];
    const { last } = await this.lastAttempts(cand.map((x) => x.id));
    const pending = cand.filter((x) => last.get(x.id)?.after.reason === 'b3_unverified');
    if (pending.length === 0) return [];
    const totals = await this.prisma.card.groupBy({ by: ['setId'], where: { setId: { in: pending.map((x) => x.id) } }, _count: { _all: true } });
    const total = new Map(totals.map((t) => [t.setId, t._count._all]));
    return pending.map((x) => ({ setId: x.id, name: x.name, externalId: x.externalId, unlinked: 0, total: total.get(x.id) ?? 0 }));
  }

  /** `GET /admin/catalog/link-exceptions`. Orden: con piezas a la venta/en revisión primero, luego `unlinked` desc. */
  async list(now = new Date()): Promise<{ summary: LinkSummary; sets: LinkExceptionSet[] }> {
    const [summary, unlinkedRows, pieces] = await Promise.all([this.summary(now), unlinkedBySet(this.prisma), piecesBySet(this.prisma)]);
    // §10.1: un set con grupo B3 sin confirmar puede estar 100 % ligado (los enlaces sí se escriben) y aun así sin precio: entra por su motivo, no por cartas sin ligar.
    const rows = [...unlinkedRows, ...(await this.b3PendingRows(new Set(unlinkedRows.map((r) => r.setId))))];
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
      let sample: LinkExceptionSet['sample'];
      if (fixed === 'promo_route') {
        const p = promoGroupFor(r.externalId)!;
        groupUsed = { groupId: p.groupId, name: null, via: 'promo_table' };
      } else if (!fixed) {
        const a = la?.after ?? {};
        const gu = a.groupUsed as { groupId?: number; name?: string | null; via?: 'auto' | 'b3' | 'confirmed' | 'promo_table' } | null | undefined;
        // La fila del job (`auto_link`) guarda grupo y vía planos; la del botón (`link_repair`), anidados en `groupUsed`.
        const flatVia = a.via as 'auto' | 'b3' | 'confirmed' | 'promo_table' | null | undefined;
        if (gu && typeof gu.groupId === 'number' && gu.via) groupUsed = { groupId: gu.groupId, name: gu.name ?? nameOfGroup(gu.groupId), via: gu.via };
        else if (typeof a.groupId === 'number' && flatVia) groupUsed = { groupId: a.groupId, name: (typeof a.groupName === 'string' ? a.groupName : null) ?? nameOfGroup(a.groupId), via: flatVia };
        else if (m?.cardGroupId != null) groupUsed = { groupId: m.cardGroupId, name: nameOfGroup(m.cardGroupId), via: m.cardGroupVia === 'confirmed' ? 'confirmed' : 'auto' };
        const stored = a.candidates as GroupCandidate[] | undefined;
        if (la) {
          if (a.failed === true) reason = 'provider_failing';
          else if (typeof a.reason === 'string') reason = a.reason as LinkExceptionReason;
          else if ((Number(a.collisions) || 0) > 0) reason = 'collisions';
          else reason = 'no_source_product'; // intento limpio (sin `name_mismatch` ni colisión guardados) y siguen cartas sin ligar: la fuente no trae producto con ese número/nombre (§10.4)
          if (reason === 'b3_unverified') {
            // Mejor candidato primero: `candidates[0]` = el grupo que eligió B3.
            const chosen = groupUsed?.groupId ?? m?.cardGroupId ?? null;
            const scored = groups && m ? scoreGroupCandidates({ name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId }, groups) : [];
            const first = chosen != null ? (scored.find((c) => c.groupId === chosen) ?? { groupId: chosen, name: nameOfGroup(chosen) ?? groupUsed?.name ?? '', publishedOn: null, productCount: null, score: 0 }) : null;
            candidates = [...(first ? [first] : []), ...scored.filter((c) => c.groupId !== chosen)].slice(0, 5);
            const smp = a.b3Sample;
            sample = Array.isArray(smp) ? (smp as NonNullable<LinkExceptionSet['sample']>).slice(0, 5) : [];
          } else if (reason === 'group_ambiguous' || reason === 'group_none') candidates = stored?.length ? stored : groups && m ? scoreGroupCandidates({ name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId }, groups) : [];
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
        ...(sample ? { sample } : {}),
        reviewable: Number(la?.after.reviewable) || 0,
        noSourceProduct: Number(la?.after.noSourceProduct) || 0,
        canConfirm: reason === 'group_ambiguous' || reason === 'group_none' || reason === 'b3_unverified',
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
      // Un reclamo «liberado» (la confirmación falló y se revirtió) no cuenta para el cupo; la fila se conserva (la bitácora no se borra).
      const claims = await tx.auditLog.findMany({ where: { action: CONFIRM_CLAIM, entityId: setId }, orderBy: { createdAt: 'desc' }, take: 5, select: { createdAt: true, after: true } });
      const prev = claims.find((c) => (c.after as { released?: boolean } | null)?.released !== true);
      if (prev && now - prev.createdAt.getTime() < LINK_REPAIR_MANUAL_COOLDOWN_MS) return LINK_REPAIR_MANUAL_COOLDOWN_MS - (now - prev.createdAt.getTime());
      claimId = (await tx.auditLog.create({ data: { actorUserId: user.id, action: CONFIRM_CLAIM, entityType: 'CardSet', entityId: setId, after: { setId } }, select: { id: true } })).id;
      return 0;
    });
    if (wait > 0) {
      throw new BusinessException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'This set was confirmed a moment ago', { retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) });
    }

    const before = { groupId: set.cardGroupId, via: set.cardGroupVia };
    // AE-10: el grupo confirmado y su bitácora van en UNA transacción (si `audit.log` falla, no queda grupo confirmado sin su fila).
    let auditId: string;
    try {
      auditId = await this.prisma.$transaction(async (tx) => {
        await tx.cardSet.update({ where: { id: setId }, data: { cardGroupId: groupId, cardGroupVia: 'confirmed' } });
        return (
          await tx.auditLog.create({
            data: { actorUserId: user.id, actorRole: user.role, action: 'catalog.group_confirmed', entityType: 'CardSet', entityId: setId, before, after: { groupId, via: 'confirmed' } },
            select: { id: true },
          })
        ).id;
      });
    } catch (e) {
      await this.releaseClaim(claimId, setId); // nada se confirmó: el cupo se devuelve (la fila se marca, no se borra)
      throw e;
    }
    const r = await this.repair.attemptSetConfirmed(setId, user.id, groups);
    if (r.error) {
      // «No persiste nada»: se devuelve la elección anterior (junto con su fila de bitácora) y el cupo.
      // La bitácora NO se borra: la fila `group_confirmed` queda y se añade la de reversa; el reclamo se marca liberado.
      await this.prisma.cardSet.update({ where: { id: setId }, data: { cardGroupId: before.groupId, cardGroupVia: before.via } });
      await this.audit.log({ actorUserId: user.id, actorRole: user.role, action: 'catalog.group_confirm_reverted', entityType: 'CardSet', entityId: setId, before: { groupId, via: 'confirmed' }, after: { ...before, reason: 'provider_failed', confirmAuditId: auditId } });
      await this.releaseClaim(claimId, setId);
      throw this.upstream(setId, new Error(r.error));
    }
    // La confirmación reinicia la espera 1/3/7 del job para este set (progreso o no, hubo una decisión humana nueva).
    await this.audit.log({ actorUserId: null, action: 'catalog.auto_link', entityType: 'CardSet', entityId: setId, after: { setId, groupId, via: 'confirmed', linked: r.linked, priced: r.priced, reason: r.reason, held: r.held, finishesAdded: r.finishesAdded, ...(r.sanity ? { sanity: r.sanity } : {}), linkedCardIds: r.linkedCardIds, noProgress: false, nextAttemptAt: null, tries: 0, trigger: 'confirm' } });
    return {
      setId,
      groupUsed: { groupId, name: group.name, via: 'confirmed' },
      linked: r.linked, priced: r.priced, collisions: r.collisions, conflicts: r.conflicts, omitted: r.omitted, examples: r.examples.slice(0, 20),
    };
  }

  private async releaseClaim(claimId: string, setId: string): Promise<void> {
    await this.prisma.auditLog.update({ where: { id: claimId }, data: { after: { setId, released: true } } }).catch(() => undefined);
  }

  /** AE-4: mensaje fijo al cliente; el detalle solo en la etiqueta del log del llamador (nunca el texto crudo del proveedor). */
  private upstream(setId: string, e: unknown): BusinessException {
    void safeErrorTag(e);
    return BusinessException.retriable('UPSTREAM_ERROR', 'The price provider failed; try again later', { setId });
  }
}

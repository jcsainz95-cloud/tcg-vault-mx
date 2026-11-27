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
import { candidateForGroup, resolveTcgcsvGroupForSet, scoreGroupCandidates, type GroupCandidate } from '../pricing/providers/tcgcsv-group-match';
import { isTcgcsvOrigin } from './tcgcsv-card-name';
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
  /** §12.4: variantes con referencia TCGCSV ya publicada en un set `via:'b3'` sin confirmar (se respetan; solo informa). */
  b3Published: number;
  /** §12.4: variantes retenidas por §12.1 (enlazadas, sin referencia TCGCSV). Derivado del estado en cada lectura. */
  b3Held: number;
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

  /**
   * §12.4 — estado B3 DERIVADO en cada lectura (nadie lo persiste): sets cuyo grupo resuelve `via:'b3'` (sin confirmar), con
   * `b3Published` (variantes ya con referencia TCGCSV) y `b3Held` (variantes enlazadas aún sin referencia TCGCSV = retenidas por §12.1).
   * La vía sale de la MISMA función del resolver sobre el `listGroups` cacheado (0 llamadas); sin caché, de la vía del último intento.
   */
  private async b3States(): Promise<Map<string, { published: number; held: number; groupId: number | null; set: { id: string; name: string; externalId: string } }>> {
    const out = new Map<string, { published: number; held: number; groupId: number | null; set: { id: string; name: string; externalId: string } }>();
    const sets = await this.prisma.cardSet.findMany({
      where: { OR: [{ cardGroupVia: null }, { cardGroupVia: { not: 'confirmed' } }] },
      select: { id: true, name: true, externalId: true, pptSetId: true, series: true, releaseDate: true, cardGroupId: true, cardGroupVia: true },
    });
    const cand = sets.filter((x) => !isTcgcsvOrigin(x.externalId) && untryableReason(x) === null);
    if (cand.length === 0) return out;
    const groups = this.groupsCache.peek();
    const b3 = new Set<string>();
    const b3Group = new Map<string, number>();
    if (groups) {
      for (const x of cand) {
        const r = await resolveTcgcsvGroupForSet(x, async () => groups);
        if (r.groupId != null && r.via === 'b3') {
          b3.add(x.id);
          b3Group.set(x.id, r.groupId);
        }
      }
    } else {
      const { last } = await this.lastAttempts(cand.map((x) => x.id));
      for (const x of cand) {
        const a = last.get(x.id)?.after ?? {};
        const gu = a.groupUsed as { via?: string; groupId?: number } | null | undefined;
        if ((gu?.via ?? a.via) === 'b3') {
          b3.add(x.id);
          const gid = gu?.groupId ?? a.groupId;
          if (typeof gid === 'number') b3Group.set(x.id, gid);
        }
      }
    }
    if (b3.size === 0) return out;
    const ids = [...b3];
    // MONEY-REF-EXEMPT: solo cuenta variantes con referencia TCGCSV (informa al dueño en la lista de excepciones); no devuelve ningún monto que se cobre, ofrezca o valúe.
    const refs = await this.prisma.priceReference.findMany({ where: { source: 'tcgcsv_singles', card: { setId: { in: ids } } }, distinct: ['cardId', 'finish'], select: { cardId: true, finish: true, card: { select: { setId: true } } } });
    const priced = new Set(refs.map((r) => `${r.cardId}|${r.finish}`));
    const products = await this.prisma.cardProduct.findMany({ where: { card: { setId: { in: ids } } }, select: { cardId: true, finishes: true, card: { select: { setId: true } } } });
    const held = new Map<string, Set<string>>();
    for (const p of products) for (const f of p.finishes) if (!priced.has(`${p.cardId}|${f}`)) held.set(p.card.setId, (held.get(p.card.setId) ?? new Set()).add(`${p.cardId}|${f}`));
    const published = new Map<string, number>();
    for (const r of refs) published.set(r.card.setId, (published.get(r.card.setId) ?? 0) + 1);
    for (const x of cand) {
      if (!b3.has(x.id)) continue;
      const st = { published: published.get(x.id) ?? 0, groupId: b3Group.get(x.id) ?? null, held: held.get(x.id)?.size ?? 0, set: { id: x.id, name: x.name, externalId: x.externalId } };
      if (st.published > 0 || st.held > 0) out.set(x.id, st);
    }
    return out;
  }

  /** `GET /admin/catalog/link-exceptions`. Orden: con piezas a la venta/en revisión primero, luego `unlinked` desc. */
  async list(now = new Date()): Promise<{ summary: LinkSummary; sets: LinkExceptionSet[] }> {
    const [summary, unlinkedRows, pieces] = await Promise.all([this.summary(now), unlinkedBySet(this.prisma), piecesBySet(this.prisma)]);
    // §10.1: un set con grupo B3 sin confirmar puede estar 100 % ligado (los enlaces sí se escriben) y aun así sin precio: entra por su motivo, no por cartas sin ligar.
    const b3 = await this.b3States();
    const have = new Set(unlinkedRows.map((r) => r.setId));
    const b3Only = [...b3.values()].filter((x) => !have.has(x.set.id));
    const b3Totals = b3Only.length ? await this.prisma.card.groupBy({ by: ['setId'], where: { setId: { in: b3Only.map((x) => x.set.id) } }, _count: { _all: true } }) : [];
    const totalOf = new Map(b3Totals.map((t) => [t.setId, t._count._all]));
    const rows: UnlinkedSetRow[] = [...unlinkedRows, ...b3Only.map((x) => ({ setId: x.set.id, name: x.set.name, externalId: x.set.externalId, unlinked: 0, total: totalOf.get(x.set.id) ?? 0 }))];
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
            // (candidatos y muestra se arman abajo, comunes al motivo derivado de §12.4)
          } else if (reason === 'group_ambiguous' || reason === 'group_none') candidates = stored?.length ? stored : groups && m ? scoreGroupCandidates({ name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId }, groups) : [];
        } else if (groups && m) {
          // Nunca intentado: solo es excepción si ya se sabe que no resolverá grupo (cálculo local sobre el `listGroups` cacheado).
          const c = scoreGroupCandidates({ name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId }, groups);
          if (m.cardGroupId == null && c.length === 0) {
            reason = 'group_none';
          } else if (!b3.has(r.setId)) continue; // pendiente de su primer intento: lo trata el job (cuenta en `unlinkedCards`, no es excepción)
        } else if (!b3.has(r.setId)) continue;
      }
      // §12.4: el set sale `b3_unverified` si b3Published > 0 || b3Held > 0 (derivado del estado en cada lectura). Un fallo del proveedor se conserva (es otro problema).
      const b3s = b3.get(r.setId);
      if (b3s && !fixed && reason !== 'provider_failing') {
        reason = 'b3_unverified';
        if (b3s.groupId != null) groupUsed = { groupId: b3s.groupId, name: groupUsed?.groupId === b3s.groupId ? groupUsed.name : nameOfGroup(b3s.groupId), via: 'b3' };
      }
      if (!reason) continue;
      if (reason === 'b3_unverified' && !fixed) {
        // Mejor candidato primero: `candidates[0]` = el grupo que eligió B3 (con su puntaje y fecha reales; `productCount` null: no hay `getProducts` en una lectura).
        const chosen = groupUsed?.groupId ?? m?.cardGroupId ?? null;
        const meta3 = m ? { name: r.name, series: m.series, releaseDate: m.releaseDate, externalId: r.externalId } : null;
        const scored = groups && meta3 ? scoreGroupCandidates(meta3, groups) : [];
        const chosenGroup = chosen != null ? groups?.find((g) => g.groupId === chosen) : undefined;
        const first = chosen != null ? (scored.find((c) => c.groupId === chosen) ?? (chosenGroup && meta3 ? candidateForGroup(meta3, chosenGroup) : { groupId: chosen, name: nameOfGroup(chosen) ?? groupUsed?.name ?? '', publishedOn: null, productCount: null, score: 0 })) : null;
        candidates = [...(first ? [first] : []), ...scored.filter((c) => c.groupId !== chosen)].slice(0, 5);
        const smp = la?.after.b3Sample;
        sample = Array.isArray(smp) ? (smp as NonNullable<LinkExceptionSet['sample']>).slice(0, 5) : [];
      }
      const nextAttempt = au && typeof au.after.nextAttemptAt === 'string' ? (au.after.nextAttemptAt as string) : null;
      out.push({
        setId: r.setId, name: r.name, unlinked: r.unlinked, total: r.total, reason, groupUsed, candidates,
        ...(sample ? { sample } : {}),
        reviewable: Number(la?.after.reviewable) || 0,
        noSourceProduct: Number(la?.after.noSourceProduct) || 0,
        b3Published: b3s?.published ?? 0,
        b3Held: b3s?.held ?? 0,
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

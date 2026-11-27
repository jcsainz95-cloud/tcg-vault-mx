import { HttpStatus, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { Finish, InventoryStatus, MovementReason } from '@prisma/client';
import { ListingPriceService } from '../pricing/listing-price.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { isSchedulerDisabled } from '../../config/test-env';
import { CardProductResolverService } from './card-product-resolver.service';
import { isTcgcsvOrigin, SET_ID_PATTERN } from './tcgcsv-card-name';
import { isNotInProviderSet } from './auto-link-stats';
import { safeErrorTag } from '../shipments/guest-mail-link';
import { BudgetExhaustedError, CircuitOpenError, DeadlineError, TcgcsvCallBudget } from './tcgcsv-call-budget';
import type { TcgcsvGroupRef } from '../pricing/pricing.types';

export type NotLinkableReason = 'no_group' | 'tcgcsv_source' | 'promo_route';
/** §AUTO-ENLACE §2 (mismo enum del contrato; la FASE 1 emite el subconjunto que mide). */
export type LinkExceptionReason = 'group_ambiguous' | 'group_none' | 'collisions' | 'name_mismatch' | 'promo_route' | 'wotc_pending' | 'provider_failing' | 'tcgcsv_source' | 'not_in_provider' | 'price_sanity' | 'finish_surge' | 'reverted' | 'b3_unverified' | 'no_source_product';
export interface GroupUsed {
  groupId: number;
  name: string | null;
  via: 'auto' | 'b3' | 'confirmed' | 'promo_table';
}

/**
 * §AUTO-ENLACE 4b: último resultado de `card-link-repair` por set (UNA consulta a la bitácora para todos los ids; 0 llamadas a proveedores).
 * Mismo parseo que `unlinkedPrice`. Sin intento previo ⇒ el set no figura en el mapa.
 */
export async function lastLinkOutcomes(
  prisma: PrismaService,
  setIds: string[],
): Promise<Map<string, { groupUsed: GroupUsed | null; reason: LinkExceptionReason | null }>> {
  const out = new Map<string, { groupUsed: GroupUsed | null; reason: LinkExceptionReason | null }>();
  if (setIds.length === 0) return out;
  // AE-5: el último intento por set lo resuelve Postgres (`DISTINCT ON`, parametrizado), no `distinct` de Prisma en memoria.
  const audits = await prisma.$queryRaw<{ entityId: string | null; after: unknown }[]>`
    SELECT DISTINCT ON ("entityId") "entityId", "after"
    FROM "AuditLog"
    WHERE "action" = 'catalog.link_repair' AND "entityId" = ANY(${setIds}::text[])
    ORDER BY "entityId", "createdAt" DESC`;
  for (const a of audits) {
    if (!a.entityId) continue;
    const after = (a.after ?? {}) as { groupUsed?: unknown; reason?: unknown };
    const gu = after.groupUsed as Partial<GroupUsed> | null | undefined;
    out.set(a.entityId, {
      groupUsed: gu && typeof gu.groupId === 'number' && gu.via ? { groupId: gu.groupId, name: typeof gu.name === 'string' ? gu.name : null, via: gu.via } : null,
      reason: typeof after.reason === 'string' ? (after.reason as LinkExceptionReason) : null,
    });
  }
  return out;
}

/** Forma EXACTA de `GET /admin/catalog/sync-status` → `unlinkedPrice` (aditivo, §PRECIO-SIN-ENLACE). */
export interface UnlinkedPriceSet {
  setId: string;
  name: string;
  /** Cartas del set con 0 `CardProduct` (sin enlace ⇒ sin precio de mercado). */
  unlinked: number;
  total: number;
  /** Productos no enlazados por número/nombre repetido, según la ÚLTIMA corrida de `card-link-repair`; `null` = aún sin medir. */
  collisions: number | null;
  /** Productos no enlazados por otro motivo (sin carta local, ya enlazada, nombre incompatible), última corrida; `null` = aún sin medir. */
  omittedProducts: number | null;
  /** Productos con otro dueño (`product_owned_by_other`), última corrida; `null` = aún sin medir. */
  conflicts: number | null;
  /** m-13: intentos consecutivos fallidos (proveedor caído…) desde el último intento bueno. */
  failedAttempts: number;
  /** m-13: tras `LINK_REPAIR_MAX_FAILED_ATTEMPTS` fallos seguidos el set queda «pendiente con error»: sigue listado con su motivo y ya no frena el marcador. */
  pendingError: boolean;
  lastError: string | null;
  /** §AUTO-ENLACE F4/C2: grupo TCGCSV usado y motivo, de la ÚLTIMA corrida (`null` = aún sin medir). Solo lectura local. */
  groupUsed: GroupUsed | null;
  reason: LinkExceptionReason | null;
}
export interface UnlinkedPriceNotLinkableSet {
  setId: string;
  name: string;
  unlinked: number;
  reason: NotLinkableReason;
  /** §AUTO-ENLACE: motivo del contrato (`group_none|promo_route|tcgcsv_source`) y grupo conocido (dpp ⇒ `promo_table`). */
  exceptionReason: LinkExceptionReason;
  groupUsed: GroupUsed | null;
}
export interface UnlinkedPrice {
  /** Cartas sin enlace en los sets REPARABLES con `unlinked > 0` (no solo los 100 listados). Los «no ligables» NO cuentan aquí. */
  totalCards: number;
  /** Solo sets reparables con `unlinked > 0`, orden descendente por `unlinked`, máx. 100. */
  sets: UnlinkedPriceSet[];
  /** Sets que `card-link-repair` no puede ligar (origen `tcgcsv:` o sin grupo TCGCSV), con su motivo. */
  notLinkable: { totalCards: number; sets: UnlinkedPriceNotLinkableSet[] };
}

/** Espacio del candado consultivo del reclamo de `link-repair` por set (`pg_advisory_xact_lock(NS, hashtext(setId))`). */
export const LINK_REPAIR_GATE_NAMESPACE = 118_125_011;
export const LINK_REPAIR_MAX_SETS = 20;
/** m-13: fallos seguidos tras los que un set deja de frenar el marcador de despliegue. */
export const LINK_REPAIR_MAX_FAILED_ATTEMPTS = 3;
/** I-5: una corrida MANUAL por set cada 10 min (si no, 429). */
export const LINK_REPAIR_MANUAL_COOLDOWN_MS = 10 * 60_000;
/** I-3: la rotación corre cada hora hasta que todo set reparable fue intentado. */
export const LINK_REPAIR_ROTATION_MS = 60 * 60_000;
const MAX_LISTED_SETS = 100;
const ACTION = 'catalog.link_repair';
const CLAIM = 'catalog.link_repair_claim';
/** AE-3: reclamo de `POST /admin/catalog/sync {setId}` (1 por set cada 10 min; mismo candado y patrón que `link-repair`). */
const SYNC_CLAIM = 'catalog.sync_claim';
const DEPLOY_MARKER = 'catalog.link_repair_deploy';
const DEPLOY_START = 'catalog.link_repair_deploy_start';

export interface LinkRepairSetResult {
  setId: string;
  name: string;
  linked: number;
  collisions: number;
  conflicts: number;
  omitted: { reason: string; count: number }[];
  notLinkable: NotLinkableReason | null;
  /** §AUTO-ENLACE B4: `PriceReference` escritas en la MISMA corrida (productos recién ligados y ya ligados del set). */
  priced: number;
  groupUsed: GroupUsed | null;
  /** Motivo por el que el set no quedó completo (`null` = sin pendientes conocidos). */
  reason: LinkExceptionReason | null;
  /** Siguiente momento en que el botón manual del set vuelve a aceptar (reclamo de 10 min); `null` en corridas automáticas. */
  /** I-1: «Disponible de nuevo a las HH:MM» (enfriamiento del botón, +10 min). `nextAttemptAt` queda como alias (contrato §7.4). */
  availableAgainAt: string | null;
  nextAttemptAt: string | null;
  /** Grupos candidatos (mejor primero, máx. 5) cuando el set no resolvió grupo; fase 3. */
  candidates?: { groupId: number; name: string; publishedOn: string | null; productCount: number | null; score: number }[];
  piecesCorrected: number;
  piecesExcluded: { reason: string; count: number }[];
  examples: { cardId: string | null; number: string | null; reason: string }[];
  /** §9.6: variantes retenidas por el candado (`omitted: price_jump`); §9.5: acabados añadidos; cordura del set. */
  held: number;
  finishesAdded: number;
  /** §10.1: variantes retenidas por grupo B3 sin confirmar + muestra ≤ 5 (alimenta la lista de excepciones). */
  reviewable?: number;
  noSourceProduct?: number;
  b3Retained?: number;
  b3Sample?: { cardName: string; number: string; finish: string; newPriceCents: number }[];
  sanity?: { checked: number; held: number };
  /** ≤ 5 precios publicados (alimenta `auto-link-runs`). */
  samples: { cardName: string; number: string; finish: string; newPriceCents: number; previousPriceCents: number | null }[];
  /** Cartas ligadas por esta corrida (≤ 600; solo bitácora, para `unlink`). */
  linkedCardIds: string[];
  error?: string;
}

/** §AUTO-ENLACE fase 2: contexto de la tanda del job (presupuesto de llamadas, `listGroups` ya bajado, tope de cartas). */
export interface AutoLinkContext {
  budget: TcgcsvCallBudget;
  groups: readonly TcgcsvGroupRef[];
  maxLinks: number;
  /** §9.5 (vi): acabados que aún puede añadir la corrida (contador compartido entre sets). */
  finishBudget?: { remaining: number };
}

export interface LinkRepairRun {
  sets: LinkRepairSetResult[];
  linked: number;
  errors: number;
  /** Agregado de las piezas (opción A del dueño); `excluded` incluye las de cliente, con venta/reserva/dinero y `ambiguous` va aparte. */
  inventory: { corrected: number; excluded: number; ambiguous: number };
  /** `deploy`: todo set reparable con `unlinked>0` fue intentado al menos una vez desde el despliegue (⇒ se escribe el marcador). */
  complete: boolean;
}

/** Piezas en estos estados son las únicas corregibles; el resto (reservada, en picking, enviada…) solo se reporta. */
const CORRECTABLE_STATUS: InventoryStatus[] = ['in_stock', 'listed'];
/** Movimientos que implican dinero ya movido con esa pieza. */
const MONEY_MOVEMENTS: MovementReason[] = ['sale', 'settle', 'chargeback_return', 'replacement', 'withdrawal', 'refund_return', 'refund_release', 'buylist_convert'];

/**
 * §PRECIO-SIN-ENLACE — `card-link-repair`: enlaza (reglas de `card-link-plan.ts`) las cartas con 0 `CardProduct`.
 *  - Rotación (I-3): hasta 20 sets por corrida, el de intento más viejo primero (`lastLinkRepairAt` = la última fila de
 *    bitácora `catalog.link_repair` del set; ⛔ sin columna nueva), cada hora tras desplegar hasta que todo set reparable fue
 *    intentado; entonces se escribe el marcador y se detiene.
 *  - Manual (I-5): `runForSet(setId)` — una corrida por set cada 10 min (429), candado `pg_advisory_xact_lock` en el reclamo.
 *  - Idempotente: solo actúa sobre cartas sin enlace (modo `onlyUnlinked` del resolver), la 2.ª corrida escribe 0 filas.
 *  - Sets «no ligables» (origen `tcgcsv:` o sin grupo TCGCSV): salen aparte, no cuentan como pendientes.
 */
@Injectable()
export class CardLinkRepairService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CardLinkRepairService.name);
  private running: Promise<LinkRepairRun> | null = null;
  private readonly inflightSets = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: CardProductResolverService,
    private readonly audit: AuditService,
    // Recalcula el precio de venta automático de las piezas corregidas (misma ruta que un cambio manual de precio).
    @Optional() private readonly listingPrice?: ListingPriceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (isSchedulerDisabled()) return;
    // La ruta de pruebas nativa (NODE_ENV=development) lo apaga con `CARD_LINK_REPAIR_BOOT=off` (setup de la integración);
    // en producción la variable no existe ⇒ corre.
    if (process.env.CARD_LINK_REPAIR_BOOT === 'off') return;
    try {
      const done = await this.prisma.auditLog.findFirst({ where: { action: DEPLOY_MARKER }, select: { id: true } });
      if (done) return;
      this.startRotation();
    } catch (e) {
      this.logger.error(`card-link-repair: no se pudo comprobar el marcador de despliegue (${(e as Error).message}).`);
    }
  }

  onModuleDestroy(): void {
    this.stopRotation();
  }

  private startRotation(): void {
    const tick = async (): Promise<void> => {
      try {
        const r = await this.run('deploy');
        if (r.complete) this.stopRotation();
      } catch (e) {
        this.logger.error(`card-link-repair: corrida de despliegue falló (${(e as Error).message}); reintenta en 1 h.`);
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), LINK_REPAIR_ROTATION_MS);
    this.timer.unref();
  }

  private stopRotation(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Todos los sets con cartas sin enlace, clasificados (consulta LOCAL; no llama a proveedores). */
  private async scan(): Promise<{
    repairable: { setId: string; unlinked: number }[];
    notLinkable: { setId: string; unlinked: number; reason: NotLinkableReason }[];
    lastAttempt: Map<string, Date>;
    lastNoGroup: Map<string, NotLinkableReason>;
    failures: Map<string, { streak: number; lastError: string | null }>;
  }> {
    const unlinkedBy = await this.prisma.card.groupBy({ by: ['setId'], where: { cardProducts: { none: {} } }, _count: { _all: true } });
    const ids = unlinkedBy.map((g) => g.setId);
    const [sets, attempts, noGroup, recent] = await Promise.all([
      this.prisma.cardSet.findMany({ where: { id: { in: ids } }, select: { id: true, externalId: true } }),
      this.prisma.auditLog.groupBy({ by: ['entityId'], where: { action: ACTION, entityId: { in: ids } }, _max: { createdAt: true } }),
      // «Sin grupo» vigente: último intento con ese motivo en los últimos 7 días (luego se reintenta: el grupo puede aparecer).
      this.prisma.auditLog.findMany({
        where: { action: ACTION, entityId: { in: ids }, createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) }, OR: [{ after: { path: ['notLinkable'], equals: 'no_group' } }, { after: { path: ['notLinkable'], equals: 'promo_route' } }] },
        select: { entityId: true, after: true },
      }),
      this.prisma.auditLog.findMany({ where: { action: ACTION, entityId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { entityId: true, after: true }, take: 5000 }),
    ]);
    // m-13: racha de intentos fallidos por set (desde el más reciente hacia atrás, hasta el primero bueno).
    const failures = new Map<string, { streak: number; lastError: string | null }>();
    const closed = new Set<string>();
    for (const a of recent) {
      if (!a.entityId || closed.has(a.entityId)) continue;
      const after = (a.after ?? {}) as { failed?: unknown; error?: unknown };
      if (after.failed === true) {
        const f = failures.get(a.entityId) ?? { streak: 0, lastError: typeof after.error === 'string' ? after.error : null };
        f.streak += 1;
        failures.set(a.entityId, f);
      } else closed.add(a.entityId);
    }
    const ext = new Map(sets.map((x) => [x.id, x.externalId]));
    const lastAttempt = new Map<string, Date>();
    for (const a of attempts) if (a.entityId && a._max.createdAt) lastAttempt.set(a.entityId, a._max.createdAt);
    const lastNoGroup = new Map<string, NotLinkableReason>();
    for (const n of noGroup) {
      if (n.entityId && !lastNoGroup.has(n.entityId)) lastNoGroup.set(n.entityId, (n.after as { notLinkable?: unknown } | null)?.notLinkable === 'promo_route' ? 'promo_route' : 'no_group');
    }
    const repairable: { setId: string; unlinked: number }[] = [];
    const notLinkable: { setId: string; unlinked: number; reason: NotLinkableReason }[] = [];
    for (const g of unlinkedBy) {
      const unlinked = g._count._all;
      if (isTcgcsvOrigin(ext.get(g.setId))) notLinkable.push({ setId: g.setId, unlinked, reason: 'tcgcsv_source' });
      else if (lastNoGroup.has(g.setId)) notLinkable.push({ setId: g.setId, unlinked, reason: lastNoGroup.get(g.setId)! });
      else repairable.push({ setId: g.setId, unlinked });
    }
    return { repairable, notLinkable, lastAttempt, lastNoGroup, failures };
  }

  /** `GET /admin/catalog/sync-status` → `unlinkedPrice`. */
  async unlinkedPrice(): Promise<UnlinkedPrice> {
    const sc = await this.scan();
    const sorted = [...sc.repairable].sort((a, b) => b.unlinked - a.unlinked);
    const totalCards = sorted.reduce((n, g) => n + g.unlinked, 0);
    const nl = [...sc.notLinkable].sort((a, b) => b.unlinked - a.unlinked);
    const top = sorted.slice(0, MAX_LISTED_SETS);
    const nlTop = nl.slice(0, MAX_LISTED_SETS);
    const ids = [...top.map((g) => g.setId), ...nlTop.map((g) => g.setId)];
    if (ids.length === 0) return { totalCards: 0, sets: [], notLinkable: { totalCards: 0, sets: [] } };
    const [sets, totals, audits] = await Promise.all([
      this.prisma.cardSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      this.prisma.card.groupBy({ by: ['setId'], where: { setId: { in: top.map((g) => g.setId) } }, _count: { _all: true } }),
      this.prisma.auditLog.findMany({
        where: { action: ACTION, entityId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, after: true },
        take: 1000,
      }),
    ]);
    const name = new Map(sets.map((s) => [s.id, s.name]));
    const total = new Map(totals.map((t) => [t.setId, t._count._all]));
    const last = new Map<string, { collisions: number | null; omitted: number | null; conflicts: number | null; groupUsed: GroupUsed | null; reason: LinkExceptionReason | null }>();
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    for (const a of audits) {
      if (!a.entityId || last.has(a.entityId)) continue;
      const after = (a.after ?? {}) as { collisions?: unknown; omitted?: unknown; conflicts?: unknown; groupUsed?: unknown; reason?: unknown };
      const gu = after.groupUsed as Partial<GroupUsed> | null | undefined;
      last.set(a.entityId, {
        collisions: num(after.collisions), omitted: num(after.omitted), conflicts: num(after.conflicts),
        groupUsed: gu && typeof gu.groupId === 'number' && gu.via ? { groupId: gu.groupId, name: typeof gu.name === 'string' ? gu.name : null, via: gu.via } : null,
        reason: typeof after.reason === 'string' ? (after.reason as LinkExceptionReason) : null,
      });
    }
    return {
      totalCards,
      sets: top.map((g) => ({
        setId: g.setId,
        name: name.get(g.setId) ?? g.setId,
        unlinked: g.unlinked,
        total: total.get(g.setId) ?? g.unlinked,
        collisions: last.get(g.setId)?.collisions ?? null,
        omittedProducts: last.get(g.setId)?.omitted ?? null,
        conflicts: last.get(g.setId)?.conflicts ?? null,
        failedAttempts: sc.failures.get(g.setId)?.streak ?? 0,
        pendingError: (sc.failures.get(g.setId)?.streak ?? 0) >= LINK_REPAIR_MAX_FAILED_ATTEMPTS,
        lastError: sc.failures.get(g.setId)?.lastError ?? null,
        groupUsed: last.get(g.setId)?.groupUsed ?? null,
        reason: last.get(g.setId)?.reason ?? null,
      })),
      notLinkable: {
        totalCards: nl.reduce((n, g) => n + g.unlinked, 0),
        sets: nlTop.map((g) => ({
          setId: g.setId, name: name.get(g.setId) ?? g.setId, unlinked: g.unlinked, reason: g.reason,
          exceptionReason: g.reason === 'no_group' ? (last.get(g.setId)?.reason ?? 'group_none') : g.reason,
          groupUsed: last.get(g.setId)?.groupUsed ?? null,
        })),
      },
    };
  }

  /** Rotación (despliegue / cada hora): una a la vez en el proceso; una segunda llamada recibe la promesa en curso. */
  run(trigger: 'deploy' | 'manual' | 'hourly' = 'manual'): Promise<LinkRepairRun> {
    if (this.running) return this.running;
    const p = this.doRun(trigger).finally(() => {
      this.running = null;
    });
    this.running = p;
    return p;
  }

  private async doRun(trigger: 'deploy' | 'manual' | 'hourly'): Promise<LinkRepairRun> {
    const out: LinkRepairRun = { sets: [], linked: 0, errors: 0, inventory: { corrected: 0, excluded: 0, ambiguous: 0 }, complete: false };
    if (trigger === 'deploy' && !(await this.prisma.auditLog.findFirst({ where: { action: DEPLOY_START }, select: { id: true } }))) {
      await this.audit.log({ actorUserId: null, action: DEPLOY_START, entityType: 'CardSet', after: {} });
    }
    const sc = await this.scan();
    const order = [...sc.repairable].sort((a, b) => {
      const ta = sc.lastAttempt.get(a.setId)?.getTime() ?? -1;
      const tb = sc.lastAttempt.get(b.setId)?.getTime() ?? -1;
      return ta - tb || b.unlinked - a.unlinked;
    });
    for (const s of order.slice(0, LINK_REPAIR_MAX_SETS)) {
      if (this.inflightSets.has(s.setId)) continue;
      this.inflightSets.add(s.setId);
      try {
        const r = await this.attemptSet(s.setId, trigger, null);
        out.sets.push(r);
        out.linked += r.linked;
        if (r.error) out.errors += 1;
        out.inventory.corrected += r.piecesCorrected;
        for (const e of r.piecesExcluded) {
          if (e.reason === 'ambiguous_finishes') out.inventory.ambiguous += e.count;
          else out.inventory.excluded += e.count;
        }
      } finally {
        this.inflightSets.delete(s.setId);
      }
    }
    if (trigger === 'deploy') {
      const start = await this.prisma.auditLog.findFirst({ where: { action: DEPLOY_START }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      const after = await this.scan();
      // Todo set reparable pendiente debe tener un intento POSTERIOR al inicio del despliegue (un intento sin progreso cuenta).
      // Un set que falló NO cuenta como intentado hasta acumular `LINK_REPAIR_MAX_FAILED_ATTEMPTS` fallos seguidos («pendiente con error»).
      out.complete =
        !!start &&
        after.repairable.every((r) => {
          if ((after.lastAttempt.get(r.setId)?.getTime() ?? 0) < start.createdAt.getTime()) return false;
          const f = after.failures.get(r.setId);
          return !f || f.streak >= LINK_REPAIR_MAX_FAILED_ATTEMPTS;
        });
      if (out.complete) {
        await this.audit.log({ actorUserId: null, action: DEPLOY_MARKER, entityType: 'CardSet', after: { linked: out.linked, sets: out.sets.length, inventory: out.inventory } });
      }
    }
    this.logger.log(
      `card-link-repair (${trigger}): sets=${out.sets.length} enlazadas=${out.linked} errores=${out.errors} ` +
        `piezas con acabado corregido=${out.inventory.corrected} excluidas=${out.inventory.excluded} ambiguas=${out.inventory.ambiguous} completa=${out.complete}.`,
    );
    return out;
  }

  /**
   * `POST /admin/catalog/link-repair {setId}` — UN set, solo cartas sin enlace. 429 si el set se reparó hace < 10 min (reclamo bajo
   * `pg_advisory_xact_lock` ⇒ dos instancias no pasan las dos). Un fallo del proveedor ⇒ 503 `UPSTREAM_ERROR` (no se audita intento).
   */
  async runForSet(setId: string, actorUserId: string): Promise<LinkRepairSetResult> {
    const exists = await this.prisma.cardSet.findUnique({ where: { id: setId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();
    if (this.inflightSets.has(setId)) throw this.tooSoon(0);
    const now = Date.now();
    let claimId: string | null = null;
    const wait = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINK_REPAIR_GATE_NAMESPACE}::int, hashtext(${setId}))`;
      const last = await tx.auditLog.findFirst({ where: { action: CLAIM, entityId: setId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (last && now - last.createdAt.getTime() < LINK_REPAIR_MANUAL_COOLDOWN_MS) return LINK_REPAIR_MANUAL_COOLDOWN_MS - (now - last.createdAt.getTime());
      claimId = (await tx.auditLog.create({ data: { actorUserId, action: CLAIM, entityType: 'CardSet', entityId: setId, after: { setId } }, select: { id: true } })).id;
      return 0;
    });
    if (wait > 0) throw this.tooSoon(wait);
    this.inflightSets.add(setId);
    try {
      const r = await this.attemptSet(setId, 'manual', actorUserId);
      if (r.error) {
        // m-12: un fallo del proveedor NO consume los 10 min (el reclamo se devuelve); el intento fallido queda en la rotación.
        if (claimId) await this.prisma.auditLog.deleteMany({ where: { id: claimId } });
        throw BusinessException.retriable('UPSTREAM_ERROR', 'The price provider failed; try again later', { setId });
      }
      const availableAgainAt = new Date(Date.now() + LINK_REPAIR_MANUAL_COOLDOWN_MS).toISOString();
      return { ...r, availableAgainAt, nextAttemptAt: availableAgainAt };
    } finally {
      this.inflightSets.delete(setId);
    }
  }

  /**
   * AE-3: límite propio de `sync` de UN set (1 cada 10 min, 429 `RATE_LIMITED`). Mismo reclamo bajo `pg_advisory_xact_lock` que
   * `runForSet` (misma NAMESPACE, llave `sync:<setId>`). Devuelve el id del reclamo para devolverlo si el proveedor falla.
   */
  async claimSync(externalSetId: string, actorUserId: string): Promise<string> {
    if (!SET_ID_PATTERN.test(externalSetId)) throw BusinessException.validation('VALIDATION_ERROR', 'Invalid setId format');
    const now = Date.now();
    let claimId = '';
    const wait = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINK_REPAIR_GATE_NAMESPACE}::int, hashtext(${'sync:' + externalSetId}))`;
      const last = await tx.auditLog.findFirst({ where: { action: SYNC_CLAIM, entityId: externalSetId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (last && now - last.createdAt.getTime() < LINK_REPAIR_MANUAL_COOLDOWN_MS) return LINK_REPAIR_MANUAL_COOLDOWN_MS - (now - last.createdAt.getTime());
      claimId = (await tx.auditLog.create({ data: { actorUserId, action: SYNC_CLAIM, entityType: 'CardSet', entityId: externalSetId, after: { setId: externalSetId } }, select: { id: true } })).id;
      return 0;
    });
    if (wait > 0) throw this.tooSoon(wait, 'This set was synced a moment ago');
    return claimId;
  }

  /** AE-3: un fallo del proveedor no consume los 10 min (igual que m-12 en `link-repair`). */
  async releaseSyncClaim(claimId: string): Promise<void> {
    await this.prisma.auditLog.deleteMany({ where: { id: claimId } }).catch(() => undefined);
  }

  private tooSoon(waitMs: number, message = 'This set was repaired a moment ago'): BusinessException {
    return new BusinessException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, message, { retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) });
  }

  /** Guarda el grupo hallado por regla (informativo; solo `auto`, jamás pisa `confirmed`). Best-effort: un fallo aquí no tumba la reparación. Idempotente. */
  private async rememberAutoGroup(setId: string, groupId: number): Promise<void> {
    try {
      const cur = await this.prisma.cardSet.findUnique({ where: { id: setId }, select: { cardGroupId: true, cardGroupVia: true } });
      if (!cur || cur.cardGroupVia === 'confirmed' || (cur.cardGroupId === groupId && cur.cardGroupVia === 'auto')) return;
      // Condicionada: si entre la lectura y la escritura alguien confirmó otro grupo, `updateMany` no toca nada.
      await this.prisma.cardSet.updateMany({ where: { id: setId, OR: [{ cardGroupVia: null }, { cardGroupVia: 'auto' }] }, data: { cardGroupId: groupId, cardGroupVia: 'auto' } });
    } catch (e) {
      this.logger.warn(`card-link-repair: no se pudo guardar el grupo automático de ${setId} (${safeErrorTag(e)}).`);
    }
  }

  /** §AUTO-ENLACE fase 2: el intento de UN set dentro de la tanda del job (mismo cuerpo que el botón; presupuesto y tope de la tanda). */
  attemptSetAuto(setId: string, ctx: AutoLinkContext): Promise<LinkRepairSetResult> {
    return this.attemptSet(setId, 'auto', null, ctx);
  }

  /** §AUTO-ENLACE fase 3: liga y precia el set con el grupo ya confirmado (mismo cuerpo que el botón; sin enfriamiento propio: lo limita `confirm`). */
  attemptSetConfirmed(setId: string, actorUserId: string, groups: readonly TcgcsvGroupRef[]): Promise<LinkRepairSetResult> {
    return this.attemptSet(setId, 'confirm', actorUserId, { groups });
  }

  /** UN set: enlaza, corrige piezas y deja la bitácora. Nunca lanza (un error queda en `error` y sin fila de intento ⇒ se reintenta). */
  private async attemptSet(setId: string, trigger: string, actorUserId: string | null, ctx?: Partial<AutoLinkContext>): Promise<LinkRepairSetResult> {
    const blank = (name: string): LinkRepairSetResult => ({
      setId, name, linked: 0, collisions: 0, conflicts: 0, omitted: [], notLinkable: null, priced: 0, groupUsed: null, reason: null, availableAgainAt: null, nextAttemptAt: null, piecesCorrected: 0, piecesExcluded: [], examples: [], held: 0, finishesAdded: 0, samples: [], linkedCardIds: [],
    });
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId }, select: { name: true, externalId: true } });
    if (!set) return { ...blank(setId), error: 'not_found' };
    const res = blank(set.name);
    try {
      const r = isTcgcsvOrigin(set.externalId) ? null : await this.resolver.resolveCardProductsForSet(setId, { onlyUnlinked: true, budget: ctx?.budget, groups: ctx?.groups, maxLinks: ctx?.maxLinks, finishBudget: ctx?.finishBudget });
      if (!r) {
        if (isTcgcsvOrigin(set.externalId)) {
          res.notLinkable = 'tcgcsv_source';
          res.reason = 'tcgcsv_source';
        } else {
          // El resolver devuelve `null` también para los sets de `PTCG_PROMO_GROUPS` (su ruta propia): ahí el grupo SÍ existe.
          const g = await this.resolver.describeGroup(setId, ctx?.groups).catch(() => null);
          if (g?.groupId != null) {
            res.notLinkable = g.via === 'promo_table' ? 'promo_route' : null;
            res.reason = g.via === 'promo_table' ? 'promo_route' : null;
            res.groupUsed = { groupId: g.groupId, name: g.name, via: g.via ?? 'auto' };
          } else {
            res.notLinkable = 'no_group';
            res.reason = g?.failure === 'ambiguous' ? 'group_ambiguous' : isNotInProviderSet(set.name) ? 'not_in_provider' : 'group_none';
            res.candidates = g?.candidates ?? [];
          }
        }
      } else {
        res.priced = r.pricesWritten ?? 0;
        res.groupUsed = { groupId: r.groupId, name: r.groupName ?? null, via: r.groupVia ?? 'auto' };
        // §AUTO-ENLACE fase 3: el grupo hallado por regla queda guardado (informativo; `confirmed` jamás se pisa). Idempotente: sin cambio ⇒ 0 filas.
        if (r.groupVia !== 'confirmed' && r.groupVia !== 'promo_table') await this.rememberAutoGroup(setId, r.groupId);
        res.linked = r.touchedCardIds?.length ?? 0;
        res.collisions = r.collisions ?? 0;
        res.conflicts = r.conflicts ?? 0;
        res.omitted = Object.entries(r.reasonCounts ?? {})
          .filter(([reason]) => reason !== 'collision' && reason !== 'owner_conflict')
          .map(([reason, count]) => ({ reason, count }));
        res.examples = r.examples ?? [];
        res.held = r.held ?? 0;
        res.finishesAdded = r.finishesAdded ?? 0;
        res.sanity = r.sanity;
        res.reviewable = r.reviewable ?? 0;
        res.noSourceProduct = r.noSourceProduct ?? 0;
        res.b3Retained = r.b3Retained ?? 0;
        res.b3Sample = (r.b3Sample ?? []).map((x) => ({ ...x }));
        res.samples = (r.samples ?? []).map((x) => ({ ...x }));
        res.linkedCardIds = (r.touchedCardIds ?? []).slice(0, 600);
        res.reason = r.sanityAborted ? 'price_sanity' : (r.b3Retained ?? 0) > 0 ? 'b3_unverified' : res.collisions > 0 ? 'collisions' : res.omitted.some((o) => o.reason === 'name_mismatch') ? 'name_mismatch' : r.finishSurge ? 'finish_surge' : null;
        if (res.linked > 0) {
          const inv = await this.correctInventoryFinish(r.touchedCardIds ?? [], trigger);
          res.piecesCorrected = inv.corrected;
          res.piecesExcluded = inv.excluded;
        }
      }
      await this.audit.log({
        actorUserId,
        action: ACTION,
        entityType: 'CardSet',
        entityId: setId,
        after: {
          setId, linked: res.linked, collisions: res.collisions, conflicts: res.conflicts,
          omitted: res.omitted.reduce((n, o) => n + o.count, 0), omittedReasons: res.omitted, notLinkable: res.notLinkable,
          priced: res.priced, groupUsed: res.groupUsed, reason: res.reason, ...(res.candidates?.length ? { candidates: res.candidates } : {}),
          piecesCorrected: res.piecesCorrected, held: res.held, finishesAdded: res.finishesAdded, ...(res.sanity ? { sanity: res.sanity } : {}), ...(res.b3Retained ? { b3Retained: res.b3Retained, b3Sample: res.b3Sample } : {}), reviewable: res.reviewable ?? 0, noSourceProduct: res.noSourceProduct ?? 0, trigger,
        },
      });
    } catch (e) {
      res.error = safeErrorTag(e); // AE-4: etiqueta/código, nunca el texto crudo del proveedor (ni en bitácora ni en `lastError`)
      // Corte de la tanda (tope/plazo/disyuntor): no es un fallo del set, no suma a su racha ni deja fila `failed`.
      if (e instanceof BudgetExhaustedError || e instanceof DeadlineError || e instanceof CircuitOpenError) {
        res.error = e.message;
        return res;
      }
      // m-13: el intento fallido queda registrado (con el error) ⇒ el set pasa al final de la rotación y cuenta su racha.
      await this.audit
        .log({ actorUserId, action: ACTION, entityType: 'CardSet', entityId: setId, after: { setId, failed: true, error: res.error.slice(0, 200), trigger } })
        .catch(() => undefined);
      this.logger.warn(`card-link-repair: set ${setId} falló (${res.error}); queda para la próxima corrida.`);
    }
    return res;
  }

  /**
   * Opción A del dueño: una pieza raw (sin versión de liga) cuyo acabado no existe en la carta recién enlazada, y la carta
   * tiene UN solo acabado, pasa a ese acabado. G3-1: SOLO piezas `ownerType='platform'` (las de clientes en bóveda se cuentan,
   * `customer_vault`, y nunca se tocan). NO se toca el costo de adquisición ni ningún otro campo: solo `finish` (y, por
   * consecuencia, el precio automático, que se recalcula). Sin pedido/envío/disputa/reserva/venta ni movimiento de dinero.
   * Escritura condicionada + auditoría por pieza; idempotente.
   */
  async correctInventoryFinish(cardIds: string[], trigger: string): Promise<{ corrected: number; excluded: { reason: string; count: number }[] }> {
    const counts = new Map<string, number>();
    const bump = (r: string): void => void counts.set(r, (counts.get(r) ?? 0) + 1);
    let corrected = 0;
    const items = await this.prisma.inventoryItem.findMany({
      where: { cardId: { in: cardIds }, productType: 'raw', cardProductId: null },
      select: {
        id: true,
        cardId: true,
        finish: true,
        status: true,
        ownerType: true,
        reservedByOrderId: true,
        card: { select: { availableFinishes: true } },
        _count: { select: { orderItems: true, shipmentItems: true, disputes: true } },
      },
    });
    const mismatched = items.filter((i) => !i.card.availableFinishes.includes(i.finish));
    const platform = mismatched.filter((i) => i.ownerType === 'platform');
    for (const i of mismatched) if (i.ownerType !== 'platform') bump('customer_vault');
    const movements = platform.length
      ? await this.prisma.inventoryMovement.findMany({
          where: { itemId: { in: platform.map((i) => i.id) }, reason: { in: MONEY_MOVEMENTS } },
          select: { itemId: true, reason: true },
        })
      : [];
    const moneyReason = new Map(movements.map((m) => [m.itemId, m.reason]));
    const fixed: string[] = [];
    for (const i of platform) {
      if (i.card.availableFinishes.length !== 1) {
        bump('ambiguous_finishes');
        continue;
      }
      // §AUTO-ENLACE fase 4 (Q1 = A): pasar una pieza a «1.ª edición» NUNCA es automático (cambia el precio); se decide por pieza en `finish-review`.
      if (i.card.availableFinishes[0].startsWith('first_edition')) {  // first_edition | first_edition_holofoil
        bump('first_edition_review');
        continue;
      }
      const blocked =
        (!CORRECTABLE_STATUS.includes(i.status) && 'status') ||
        (i.reservedByOrderId != null && 'reserved') ||
        (i._count.orderItems > 0 && 'order') ||
        (i._count.shipmentItems > 0 && 'shipment') ||
        (i._count.disputes > 0 && 'dispute') ||
        (moneyReason.has(i.id) && `movement:${moneyReason.get(i.id)}`);
      if (blocked) {
        bump(blocked);
        continue;
      }
      const to: Finish = i.card.availableFinishes[0];
      const done = await this.prisma.$transaction(async (tx) => {
        // Condicionada: solo si la pieza sigue libre, de la plataforma y con el acabado leído (una venta concurrente no se pisa).
        const w = await tx.inventoryItem.updateMany({
          where: { id: i.id, ownerType: 'platform', finish: i.finish, status: { in: CORRECTABLE_STATUS }, reservedByOrderId: null, orderItems: { none: {} } },
          data: { finish: to },
        });
        if (w.count !== 1) return false;
        await this.audit.log(
          {
            actorUserId: null,
            action: 'inventory.finish_corrected',
            entityType: 'InventoryItem',
            entityId: i.id,
            before: { finish: i.finish },
            after: { finish: to, cardId: i.cardId, reason: 'card-link-repair', trigger },
          },
          tx,
        );
        return true;
      });
      if (done) {
        corrected += 1;
        fixed.push(i.id);
      } else bump('changed_concurrently');
    }
    if (fixed.length > 0 && this.listingPrice) {
      try {
        await this.listingPrice.run('manual_price', fixed);
      } catch (e) {
        this.logger.warn(`card-link-repair: no se pudo recalcular el precio de ${fixed.length} pieza(s) corregida(s) (${(e as Error).message}); lo hará el recálculo diario.`);
      }
    }
    return { corrected, excluded: [...counts.entries()].map(([reason, count]) => ({ reason, count })) };
  }
}

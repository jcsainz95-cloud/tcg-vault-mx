/**
 * label-recovery.service.ts — 💰🔒 la compra en vuelo sin respuesta (API_CONTRACT §M4-SHIP.19.18.4, §19.26.3 (b) 5, §19.27.4–.6,
 * §19.28.4–.5, §19.29.1.3–.4, §19.29.4 tabla del libro).
 *
 *  - `recoverInFlightLabel(shipmentId, now)`: verificación de SOLO LECTURA del proveedor. Llama **solo**
 *    `port.recentShipments`, `port.balance` y `port.getShipment` (⛔ `purchase`, `cancel`, `protect`: PS-117). Un cuerpo,
 *    dos llamadores (`C-SDX-5`): el job `shipment-label-processing` (D2d) y `label/release`. Adopta **solo por folio
 *    exacto** (§19.28.4). ⭐ D2d: la evidencia negativa (§19.27.4 paso 4 con §19.28.9: dos testigos, contaminación ampliada,
 *    filas `label_verify_clean/dirty`, cable trampa) está CONSTRUIDA y sigue APAGADA (`INFLIGHT_NEGATIVE_VERIFIED = false`):
 *    con la constante en `false` nunca decide y a `T_UNKNOWN` sale `not_calibrated`.
 *  - `POST /admin/shipments/:id/label/release` (solo `super_admin`, `@MoneyOut()`): guardas, `confirmConflict`, busca antes
 *    de liberar; `found` ⇒ adopta; si no ⇒ libera con el CAS de `since` exacto y la fila del intento (C-17).
 *  - ⭐ D2d, lo que el JOB hace con el veredicto: `adoptFound` (`via:'recent_list'`, cable trampa), `autoRelease`
 *    (`auto_not_sent` / `auto_verified`, CAS de `since` exacto + CAS inverso sobre el intento), `markUncertain` (una vez por
 *    `since`; AG-9 (a)) y `recordDuplicates` (dos filas `origin:'duplicate'` + `label_orphan`).
 */
import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ProviderShipmentState, RecentProviderShipment, RecentShipmentsResult } from '../shipping-provider/shipping-provider.port';
import { SpendAlertsService } from '../spend-alerts/spend-alerts.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { LabelActor, PersistClaim, ShipmentLabelService } from './label-purchase.service';
import { LABEL_VERIFY_CONFIG, LabelVerifyConfig, NEGATIVE_TRIPWIRE_MS, RECENT_DETAIL_MAX } from './label-verify.constants';
import { InFlightUncertainReason, asRate } from './label-view';
import { ShipmentRateDTO } from './label-dto';

type Tx = Prisma.TransactionClient;
/** La fila del intento ya no estaba `pending` con el `sentAt` esperado (una rama ganó la otra): rollback, nada escrito. */
class ReleaseRaced extends Error {}
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export type InFlightVerdict =
  | { outcome: 'found'; providerShipmentId: string }
  | { outcome: 'not_charged' }
  | { outcome: 'not_sent' }
  | { outcome: 'pending' }
  | { outcome: 'uncertain'; reason: InFlightUncertainReason };

/** Actor de las escrituras de la verificación en la bitácora (§19.27.4: «Actor `system:label-verify`»). */
export const VERIFY_ACTOR = 'system:label-verify';

/** Una lectura de `recoverInFlightLabel` (§19.27.4 con §19.28.4/.9). */
export interface RecoveryRead {
  verdict: InFlightVerdict;
  /** `found`: el detalle leído del envío adoptado. */
  detail: ProviderShipmentState | null;
  /** El listado leído (o `null` si no se leyó): la conciliación de huérfanas lo reusa sin peticiones nuevas (§19.28.6). */
  listing: RecentShipmentsResult | null;
  /** `uncertain('duplicate')`: los ≥ 2 envíos con nuestro folio exacto (§19.28.4: los dos van a `label_orphan`). */
  duplicates: RecentProviderShipment[];
  /** `not_charged`: las dos lecturas limpias (§19.27.5 «`firstCleanAt`, `lastCleanAt`»). */
  clean?: { firstCleanAt: string; lastCleanAt: string };
}

export interface VerdictDTO {
  outcome: InFlightVerdict['outcome'];
  reason: InFlightUncertainReason | null;
}

/** `{ note: string (10..300), confirmConflict?: boolean }` ⇒ `400 VALIDATION_ERROR {field}`. */
export function parseReleaseBody(raw: unknown): { note: string; confirmConflict: boolean } {
  const b = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length < 10 || note.length > 300) throw BusinessException.badRequest('VALIDATION_ERROR', 'note must be 10..300 characters', { field: 'note' });
  if (b.confirmConflict !== undefined && typeof b.confirmConflict !== 'boolean') {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'confirmConflict must be a boolean', { field: 'confirmConflict' });
  }
  return { note, confirmConflict: b.confirmConflict === true };
}

/**
 * §19.28.4 — los candidatos de la ventana de S (función PURA, un cuerpo): `id ∉ knownIds`, `createdAt` LEGIBLE dentro de
 * `[since − SKEW, since + PURCHASE_MAX_LIFE + SKEW]`, `source ∈ {null, 'api'}`. ⛔ `createdAt` nulo ya no es candidato.
 */
export function inFlightCandidates(
  listed: readonly RecentProviderShipment[],
  knownIds: ReadonlySet<string>,
  since: Date,
  cfg: Pick<LabelVerifyConfig, 'tVerifySkewMs' | 'purchaseMaxLifeMs'>,
): RecentProviderShipment[] {
  const from = since.getTime() - cfg.tVerifySkewMs;
  const to = since.getTime() + cfg.purchaseMaxLifeMs + cfg.tVerifySkewMs;
  return listed.filter((c) => {
    if (knownIds.has(c.providerShipmentId)) return false;
    if (c.source !== null && c.source !== 'api') return false;
    if (c.createdAt === null) return false;
    const t = Date.parse(c.createdAt);
    return Number.isFinite(t) && t >= from && t <= to;
  });
}

interface Snapshot {
  row: ShipmentRequest;
  since: Date;
  attempt: { id: string; actorUserId: string; sentAt: Date | null; providerReference: string | null; expectedChargeCents: number } | null;
  balanceBeforeCents: number | null;
  conflict: { otherShipmentId: string | null } | null;
}

@Injectable()
export class ShipmentLabelRecoveryService {
  private readonly logger = new Logger(ShipmentLabelRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly labels: ShipmentLabelService,
    private readonly alerts: SpendAlertsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
    @Inject(LABEL_VERIFY_CONFIG) private readonly cfg: LabelVerifyConfig,
  ) {}

  // ================================================================ la verificación (solo lectura)

  /** Lo que la verificación lee de NUESTRA base para un reclamo vivo sin id. `null` ⇒ no hay reclamo sin id. */
  private async snapshot(shipmentId: string): Promise<Snapshot | null> {
    const row = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId } });
    if (!row || row.labelProcessingSince === null || row.providerShipmentId !== null) return null;
    const since = row.labelProcessingSince;
    const attempt = await this.prisma.shipmentLabelAttempt.findUnique({
      where: { shipmentRequestId_since: { shipmentRequestId: shipmentId, since } },
      select: { id: true, actorUserId: true, sentAt: true, providerReference: true, expectedChargeCents: true },
    });
    const sentLog = attempt?.sentAt
      ? await this.prisma.auditLog.findFirst({
          where: { entityId: shipmentId, action: 'shipment.label_purchase_sent', createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          select: { after: true },
        })
      : null;
    const sentAfter = (sentLog?.after ?? {}) as Record<string, unknown>;
    const balanceBeforeCents = sentAfter.since === since.toISOString() && typeof sentAfter.balanceBeforeCents === 'number' ? sentAfter.balanceBeforeCents : null;
    const conflictLog = await this.prisma.auditLog.findFirst({
      where: { entityId: shipmentId, action: 'shipment.label_conflict', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { after: true },
    });
    const conflict = conflictLog ? { otherShipmentId: ((conflictLog.after ?? {}) as Record<string, unknown>).otherShipmentId as string | null ?? null } : null;
    return { row, since, attempt, balanceBeforeCents, conflict };
  }

  /** `knownIds` (§19.27.4 + §19.28.4) acotado a los ids del listado: los de las filas, del libro y de la bitácora. */
  private async knownIdsAmong(ids: readonly string[], since: Date): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const [rows, paid, logs] = await Promise.all([
      this.prisma.shipmentRequest.findMany({ where: { providerShipmentId: { in: [...ids] } }, select: { providerShipmentId: true } }),
      this.prisma.shipmentPaidLabel.findMany({ where: { providerShipmentId: { in: [...ids] } }, select: { providerShipmentId: true } }),
      this.prisma.auditLog.findMany({
        where: {
          action: { in: ['shipment.label_cancelled', 'shipment.label_failed', 'shipment.label_adopted', 'shipment.label_orphan', 'shipment.label_conflict'] },
          createdAt: { gte: new Date(since.getTime() - this.cfg.tVerifySkewMs) },
        },
        select: { before: true, after: true },
      }),
    ]);
    const known = new Set<string>();
    for (const r of rows) if (r.providerShipmentId) known.add(r.providerShipmentId);
    for (const p of paid) known.add(p.providerShipmentId);
    for (const l of logs) {
      for (const j of [l.before, l.after]) {
        const v = (j ?? {}) as Record<string, unknown>;
        if (typeof v.providerShipmentId === 'string') known.add(v.providerShipmentId);
      }
    }
    return known;
  }

  /**
   * §19.27.4 con §19.28.4/.5/.9 — UNA lectura. ⛔ Solo `recentShipments`, `balance`, `getShipment` (PS-117). `found` trae el
   * detalle leído (para persistir sin una segunda lectura); `listing` es el listado leído (la conciliación de huérfanas del
   * job lo reusa: «sin peticiones nuevas», §19.28.6); `duplicates` los envíos con NUESTRO folio exacto cuando son ≥ 2.
   * Escribe en NUESTRA base solo las filas de la evidencia negativa (`label_verify_clean/dirty`, §19.27.4 paso 4) cuando la
   * constante está encendida.
   */
  async recoverInFlightLabel(shipmentId: string, now: Date): Promise<RecoveryRead> {
    const none = { detail: null, listing: null, duplicates: [] as RecentProviderShipment[] };
    const snap = await this.snapshot(shipmentId);
    if (!snap) return { verdict: { outcome: 'pending' }, ...none };
    const { since, attempt } = snap;
    const age = now.getTime() - since.getTime();
    const late = age >= this.cfg.tUnknownMs;
    // §19.28.5 / C-16: sin `sentAt` (la compra NO salió) y pasada la vida máxima ⇒ `not_sent` (hecho local).
    if (!attempt?.sentAt) {
      return { verdict: age >= this.cfg.purchaseMaxLifeMs ? { outcome: 'not_sent' } : { outcome: 'pending' }, ...none };
    }
    // Paso 1: un conflicto registrado ⇒ ni adopción ni liberación automáticas.
    if (snap.conflict) return { verdict: late ? { outcome: 'uncertain', reason: 'conflict' } : { outcome: 'pending' }, ...none };

    const chosen = asRate(snap.row.chosenRateJson) as ShipmentRateDTO | null;
    const cp = typeof (snap.row.addressSnapshot as Record<string, unknown> | null)?.postalCode === 'string'
      ? String((snap.row.addressSnapshot as Record<string, unknown>).postalCode).trim()
      : null;
    const ours = attempt.providerReference;
    let ambiguous = false;
    let unreadable = false;
    /** §19.28.9 (1): un candidato de la ventana cuyo folio NO se leyó (ni en el listado ni en el detalle). */
    let folioUnread = false;
    /** §19.28.9 (1): algún envío de la cuenta (en `[since − SKEW, now]`, o sin fecha) lleva NUESTRO folio. */
    let oursListed = false;
    let candidates: RecentProviderShipment[] = [];
    let listing: RecentShipmentsResult | null = null;

    // Paso 2–3: el listado y la adopción por folio exacto.
    try {
      const list = await this.selection.port.recentShipments(new Date(since.getTime() - this.cfg.tVerifySkewMs));
      listing = list;
      if (!list.readable) {
        unreadable = true;
      } else {
        const known = await this.knownIdsAmong(list.shipments.map((s) => s.providerShipmentId), since);
        candidates = inFlightCandidates(list.shipments, known, since, this.cfg);
        // Folio de los candidatos sin folio en el listado: del detalle, si la paquetería coincide (≤ RECENT_DETAIL_MAX).
        let details = 0;
        const withRef: (RecentProviderShipment & { detail?: ProviderShipmentState })[] = [];
        for (const c of candidates) {
          if (c.providerReference !== null) {
            withRef.push(c);
            continue;
          }
          if (!chosen || c.carrierName !== chosen.carrierName) {
            folioUnread = true; // no se lee (otra paquetería): para la evidencia negativa, la lectura no es limpia
            continue;
          }
          if (details >= RECENT_DETAIL_MAX) {
            unreadable = true; // más candidatos sin folio que lecturas ⇒ el listado no vota
            folioUnread = true;
            continue;
          }
          details += 1;
          try {
            const d = await this.selection.port.getShipment(c.providerShipmentId);
            if ((d.providerReference ?? null) === null) folioUnread = true;
            withRef.push({ ...c, providerReference: d.providerReference ?? null, detail: d });
          } catch {
            unreadable = true;
            folioUnread = true;
          }
        }
        const lo = since.getTime() - this.cfg.tVerifySkewMs;
        oursListed = !!ours && [...list.shipments, ...withRef].some((s) => {
          if (s.providerReference !== ours) return false;
          const t = s.createdAt ? Date.parse(s.createdAt) : NaN;
          return !Number.isFinite(t) || (t >= lo && t <= now.getTime());
        });
        const mine = ours ? withRef.filter((c) => c.providerReference === ours) : [];
        // Con nuestro folio FUERA de la ventana (o sin fecha) ⇒ ambiguo (no actúa) + log.
        const outside = ours
          ? list.shipments.filter((s) => s.providerReference === ours && !known.has(s.providerShipmentId) && !candidates.some((c) => c.providerShipmentId === s.providerShipmentId))
          : [];
        if (outside.length > 0) {
          ambiguous = true;
          this.logger.warn(`inflight_folio_outside_window shipmentId=${shipmentId} n=${outside.length}`);
        }
        if (mine.length >= 2) {
          this.logger.error(`inflight_duplicate shipmentId=${shipmentId} n=${mine.length}`);
          return { verdict: { outcome: 'uncertain', reason: 'duplicate' }, detail: null, listing, duplicates: mine.map(({ detail: _d, ...c }) => c) };
        }
        if (mine.length === 1 && !ambiguous) {
          const c = mine[0];
          const carrierOk = !!chosen && c.carrierName === chosen.carrierName;
          const cpOk = c.postalCodeTo === null || (cp !== null && c.postalCodeTo.trim() === cp);
          if (!carrierOk || !cpOk) {
            ambiguous = true;
            this.logger.error(`inflight_folio_mismatch shipmentId=${shipmentId} carrier=${carrierOk} cp=${cpOk}`);
          } else if (this.cfg.adoptionEnabled) {
            try {
              const d = c.detail ?? (await this.selection.port.getShipment(c.providerShipmentId));
              return { verdict: { outcome: 'found', providerShipmentId: c.providerShipmentId }, detail: d, listing, duplicates: [] };
            } catch {
              unreadable = true;
            }
          }
        }
      }
    } catch (e) {
      unreadable = true;
      this.logger.warn(`recentShipments ilegible shipmentId=${shipmentId}: ${e instanceof ShippingProviderError ? e.code : String(e)}`);
    }

    // El saldo se lee UNA vez: lo usan la evidencia negativa (paso 4) y el motivo de la incertidumbre (paso 5).
    const negative = this.cfg.negativeVerified && age >= this.cfg.tVerifyMinMs && !ambiguous;
    let delta: number | null = null;
    if (negative || late) {
      if (snap.balanceBeforeCents !== null) {
        try {
          const b = await this.selection.port.balance();
          delta = snap.balanceBeforeCents - b.balanceCents;
        } catch {
          unreadable = true;
        }
      } else {
        unreadable = true; // sin la foto del 7b, el saldo no vota (§19.27.3)
      }
    }

    // Paso 4 (§19.28.9): la evidencia negativa — DOS testigos (listado y saldo), dos lecturas limpias separadas ≥ GAP.
    if (negative) {
      const tripped = await this.prisma.auditLog.findFirst({
        where: { action: 'shipment.inflight_negative_violated', createdAt: { gt: new Date(now.getTime() - NEGATIVE_TRIPWIRE_MS) } },
        select: { id: true },
      });
      if (tripped) {
        // Cable trampa: una evidencia negativa que resultó falsa apaga sola la liberación (sale `not_calibrated`).
        this.logger.warn(`inflight_negative_tripped shipmentId=${shipmentId}: no existe not_charged mientras haya una violación en 30 días`);
      } else {
        const contaminated = await this.contamination(shipmentId, since, now);
        const listingClean = !!listing && listing.readable && listing.coversFrom && !folioUnread && !oursListed && !unreadable;
        const balanceClean = delta === 0 && contaminated === null;
        if (contaminated) unreadable = true; // el saldo NO vota (⛔ nunca se libera con un solo testigo)
        const dirtyReason = !listingClean ? 'listing' : contaminated ? `contaminated:${contaminated}` : 'balance';
        const v = await this.recordVerifyRead(shipmentId, since, listingClean && balanceClean, dirtyReason, candidates.length, delta, now);
        if (v) return { verdict: { outcome: 'not_charged' }, detail: null, listing, duplicates: [], clean: v };
      }
    }
    if (!late) return { verdict: { outcome: 'pending' }, detail: null, listing, duplicates: [] };

    // Paso 5: el motivo de la incertidumbre (precedencia: conflict > charged_not_found > ambiguous > balance_moved >
    // unreadable > not_calibrated).
    let reason: InFlightUncertainReason;
    if (delta !== null && delta === attempt.expectedChargeCents && candidates.length === 0) reason = 'charged_not_found';
    else if (ambiguous) reason = 'ambiguous';
    else if (delta !== null && delta !== 0) reason = 'balance_moved';
    else if (unreadable) reason = 'unreadable';
    else reason = 'not_calibrated';
    return { verdict: { outcome: 'uncertain', reason }, detail: null, listing, duplicates: [] };
  }

  /**
   * §19.28.9 (2) — la contaminación del saldo en la ventana de S (devuelve qué la contaminó, o `null`): otro reclamo en
   * `[since, now]`; otra `label_purchase_sent` en `[since − T_DEBIT_LAG, now]`; una cancelación (`label_cancelled` o
   * `providerCancelConfirmedAt`) en `[since − T_REFUND_LAG, now]`; un `ShipmentCostAdjustment` en `[since, now]`.
   */
  private async contamination(shipmentId: string, since: Date, now: Date): Promise<string | null> {
    const debitFrom = new Date(since.getTime() - this.cfg.tDebitLagMs);
    const refundFrom = new Date(since.getTime() - this.cfg.tRefundLagMs);
    const [requested, sent, cancelled, confirmed, adjusted] = await Promise.all([
      this.prisma.auditLog.findFirst({ where: { action: 'shipment.label_requested', entityId: { not: shipmentId }, createdAt: { gte: since, lte: now } }, select: { id: true } }),
      this.prisma.auditLog.findFirst({ where: { action: 'shipment.label_purchase_sent', entityId: { not: shipmentId }, createdAt: { gte: debitFrom, lte: now } }, select: { id: true } }),
      this.prisma.auditLog.findFirst({ where: { action: 'shipment.label_cancelled', createdAt: { gte: refundFrom, lte: now } }, select: { id: true } }),
      this.prisma.shipmentRequest.findFirst({ where: { providerCancelConfirmedAt: { gte: refundFrom, lte: now } }, select: { id: true } }),
      this.prisma.shipmentCostAdjustment.findFirst({ where: { observedAt: { gte: since, lte: now } }, select: { id: true } }),
    ]);
    if (requested) return 'label_requested';
    if (sent) return 'label_purchase_sent';
    if (cancelled || confirmed) return 'label_cancelled';
    if (adjusted) return 'cost_adjustment';
    return null;
  }

  /**
   * §19.27.4 paso 4 — las filas `label_verify_clean/dirty` de UN `since` (actor de sistema; ⛔ sin CP, sin dirección, sin el
   * saldo absoluto). Limpia ∧ existe una limpia de este `since` con `createdAt ≤ now − GAP` y ninguna sucia posterior ⇒
   * devuelve `{firstCleanAt, lastCleanAt}` (⇒ `not_charged`). Limpia sin esa ⇒ escribe `clean` (si no hay ya una limpia
   * desde la última sucia). No limpia ⇒ escribe `dirty` SOLO si la última fila era `clean` (una por transición).
   */
  private async recordVerifyRead(
    shipmentId: string,
    since: Date,
    clean: boolean,
    dirtyReason: string,
    candidates: number,
    delta: number | null,
    now: Date,
  ): Promise<{ firstCleanAt: string; lastCleanAt: string } | null> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityId: shipmentId, action: { in: ['shipment.label_verify_clean', 'shipment.label_verify_dirty'] }, after: { path: ['since'], equals: since.toISOString() } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, createdAt: true },
    });
    let lastDirty = -1;
    rows.forEach((r, i) => {
      if (r.action === 'shipment.label_verify_dirty') lastDirty = i;
    });
    const cleanAfter = rows.slice(lastDirty + 1).filter((r) => r.action === 'shipment.label_verify_clean');
    const write = (action: string, extra: Record<string, unknown>) =>
      this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action,
          entityType: 'ShipmentRequest',
          entityId: shipmentId,
          after: { since: since.toISOString(), candidates, ...(delta !== null ? { balanceDeltaCents: delta } : {}), ...extra, actor: VERIFY_ACTOR } as Prisma.InputJsonValue,
          createdAt: now,
        },
      });
    if (clean) {
      if (cleanAfter.length > 0 && cleanAfter[0].createdAt.getTime() <= now.getTime() - this.cfg.tVerifyGapMs) {
        return { firstCleanAt: cleanAfter[0].createdAt.toISOString(), lastCleanAt: now.toISOString() };
      }
      if (cleanAfter.length === 0) await write('shipment.label_verify_clean', {});
      return null;
    }
    if (rows.length > 0 && rows[rows.length - 1].action === 'shipment.label_verify_clean') await write('shipment.label_verify_dirty', { reason: dirtyReason });
    return null;
  }

  // ================================================================ «Liberar»

  /** `POST …/label/release` (§19.18.4 con §19.26.3 (b) 5 y §19.27.6). */
  async release(shipmentId: string, raw: unknown, actor: LabelActor): Promise<{ outcome: 'adopted' | 'released'; shipment: unknown; verdict: VerdictDTO }> {
    const { note, confirmConflict } = parseReleaseBody(raw);
    if (this.selection.kind === 'noop') throw ShippingProviderError.notConfigured(['env']).toBusinessException();
    const exists = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();
    const now = this.clock.now();

    // 2. Guardas bajo candado de fila (solo lectura).
    const since = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      this.assertReleasable(row, now);
      const s = row.labelProcessingSince as Date;
      const conflict = await tx.auditLog.findFirst({
        where: { entityId: shipmentId, action: 'shipment.label_conflict', createdAt: { gte: s } },
        orderBy: { createdAt: 'desc' },
        select: { after: true },
      });
      if (conflict && !confirmConflict) {
        throw new BusinessException('LABEL_NOT_RELEASABLE', 409, 'A provider conflict was recorded; confirm it to release', {
          reason: 'provider_conflict',
          otherShipmentId: ((conflict.after ?? {}) as Record<string, unknown>).otherShipmentId ?? null,
        });
      }
      return s;
    }, TX);

    // 3. Buscar antes de liberar (solo lectura; ⛔ nunca `purchase`).
    const { verdict, detail } = await this.recoverInFlightLabel(shipmentId, now);
    const v: VerdictDTO = { outcome: verdict.outcome, reason: verdict.outcome === 'uncertain' ? verdict.reason : null };

    // 4. Encontrada ⇒ se adopta por la rama de éxito de §19.7 paso 9 (con el `since` LEÍDO).
    if (verdict.outcome === 'found' && detail) {
      const claim = await this.claimOf(shipmentId, since);
      if (claim) {
        const result = { ...detail, providerShipmentId: verdict.providerShipmentId };
        const mark = { via: 'reference' as const, note };
        const res = result.trackingNumber && !result.error
          ? await this.labels.persistLabeled(claim, actor, result, null, 'adopted', mark)
          : await this.labels.persistProcessing(claim, actor, result, 'adopted', mark);
        return { outcome: 'adopted', shipment: res.shipment, verdict: v };
      }
    }

    // AG-9 (a): cobrada y sin guía (§19.29.6) — una vez por intento.
    if (verdict.outcome === 'uncertain' && verdict.reason === 'charged_not_found') {
      const att = await this.prisma.shipmentLabelAttempt.findUnique({ where: { shipmentRequestId_since: { shipmentRequestId: shipmentId, since } } });
      if (att) {
        await this.alerts.raise(this.prisma, {
          kind: 'label_charged_unexplained',
          severity: 'immediate',
          dedupKey: `ag9:nf:${att.id}`,
          shipmentRequestId: shipmentId,
          amountCents: att.expectedChargeCents,
          facts: { cause: 'charged_not_found', expectedChargeCents: att.expectedChargeCents, providerReference: att.providerReference },
        }, now);
      }
    }

    // 5. No encontrada ⇒ liberar con el CAS de `since` exacto y la fila del intento (C-17).
    const verified = verdict.outcome === 'not_charged' || verdict.outcome === 'not_sent';
    const via = verified ? 'manual_verified' : 'manual';
    const released = await this.prisma.$transaction(async (tx) => {
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      const r = await tx.shipmentRequest.updateMany({
        where: { id: shipmentId, labelProcessingSince: since, providerShipmentId: null },
        // El MISMO `data` que la rama de rechazo (§19.7 paso 9; escrito en línea para el censo de `status`).
        data: {
          labelProcessingSince: null,
          providerQuotationId: null,
          providerRateId: null,
          chosenRateJson: Prisma.DbNull,
          recommendedRateJson: Prisma.DbNull,
          rateChosenByUserId: null,
          rateChosenAt: null,
          packageCode: null,
          packageDimsJson: Prisma.DbNull,
          declaredValueCents: null,
          insuredValueCents: null,
        },
      });
      if (r.count !== 1) return { ok: false as const };
      await tx.shipmentLabelAttempt.updateMany({
        where: { shipmentRequestId: shipmentId, since, outcome: 'pending' },
        data: verified
          ? { outcome: 'not_charged', outcomeReason: verdict.outcome === 'not_sent' ? 'not_sent' : 'manual_verified', outcomeAt: now }
          : { outcome: 'released_unverified', outcomeReason: 'manual', outcomeAt: now },
      });
      const quote = row.providerQuotationId
        ? await tx.shipmentQuote.findFirst({ where: { shipmentRequestId: shipmentId, providerQuotationId: row.providerQuotationId }, select: { id: true } })
        : null;
      await this.labels.audit(
        tx,
        actor,
        shipmentId,
        'shipment.label_released',
        { note, via, verdict: v },
        now,
        { labelProcessingSince: since.toISOString(), quoteId: quote?.id ?? null, rateId: row.providerRateId, priceCents: asRate(row.chosenRateJson)?.priceCents ?? null },
      );
      return { ok: true as const };
    }, TX);
    if (!released.ok) {
      const row = await this.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      this.assertReleasable(row, now);
      throw BusinessException.conflict('CONFLICT', 'The claim changed while releasing; reload it');
    }
    return { outcome: 'released', shipment: (await this.labels.respond(shipmentId, actor, 'in_progress')).shipment, verdict: v };
  }

  // ================================================================ lo que el JOB hace con el veredicto (D2d, §19.27.5)

  /**
   * `found` en el job (§19.27.5, §19.28.4, §19.28.7): adopta por la rama de éxito de §19.7 paso 9 con el `since` LEÍDO
   * (`persistLabeled`/`persistProcessing`, que llevan `labelProcessingSince: since` exacto en el `WHERE`); bitácora
   * `shipment.label_adopted {via:'recent_list'}` con actor de sistema; envío ya `cancelado` ⇒ §19.18.3 (persistir con
   * `auto_close` y `cancel`, `after.via:'recent_list_folio'`). 🔒 Cable trampa (§19.28.9): si ese `since` ya tenía una
   * `label_verify_clean` ⇒ `shipment.inflight_negative_violated` + log `error`. Las respuestas `409` de la clasificación
   * de `count 0` se propagan (el job las cuenta).
   */
  async adoptFound(shipmentId: string, since: Date, providerShipmentId: string, detail: ProviderShipmentState, now: Date): Promise<'adopted' | 'no_claim'> {
    const claim = await this.claimOf(shipmentId, since);
    if (!claim) return 'no_claim';
    const clean = await this.prisma.auditLog.findFirst({
      where: { entityId: shipmentId, action: 'shipment.label_verify_clean', after: { path: ['since'], equals: since.toISOString() } },
      select: { id: true },
    });
    if (clean) {
      this.logger.error(`inflight_negative_violated shipmentId=${shipmentId} since=${since.toISOString()}: una lectura limpia resultó falsa`);
      await this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.inflight_negative_violated',
          entityType: 'ShipmentRequest',
          entityId: shipmentId,
          after: { since: since.toISOString(), providerShipmentId, actor: VERIFY_ACTOR },
          createdAt: now,
        },
      });
    }
    // §19.28.9 (2): la cola de las lentas — en qué minuto apareció la que acabó en `found`.
    this.logger.log(`inflight_calibration phase=in_flight fp=${createHash('sha256').update(providerShipmentId).digest('hex').slice(0, 12)} offsetMin=${Math.floor((now.getTime() - since.getTime()) / 60_000)}`);
    const result = { ...detail, providerShipmentId };
    const mark = { via: 'recent_list' as const, actorTag: VERIFY_ACTOR };
    if (result.trackingNumber && !result.error) await this.labels.persistLabeled(claim, null, result, null, 'adopted', mark);
    else await this.labels.persistProcessing(claim, null, result, 'adopted', mark);
    return 'adopted';
  }

  /**
   * `not_sent` (§19.28.5) y `not_charged` (§19.27.5) en el job: libera con el CAS de `since` EXACTO (⛔ nunca suelta un
   * reclamo más nuevo) y, en la MISMA tx, el CAS inverso sobre la fila del intento (C-17: `outcome:'pending'` ∧ `sentAt`
   * nulo para `not_sent`, no nulo para `not_charged`) ⇒ las dos ramas se excluyen por fila. Bitácora `shipment.label_released
   * {via:'auto_not_sent'|'auto_verified'}`, actor `system:label-verify`. Cero llamadas al proveedor. `false` ⇔ el reclamo ya
   * no era ese (CAS 0): nada escrito.
   */
  async autoRelease(
    shipmentId: string,
    since: Date,
    via: 'auto_not_sent' | 'auto_verified',
    now: Date,
    clean?: { firstCleanAt: string; lastCleanAt: string },
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
        const r = await tx.shipmentRequest.updateMany({
          where: { id: shipmentId, labelProcessingSince: since, providerShipmentId: null },
          // El MISMO `data` que la rama de rechazo (§19.31.7 (d): el inverso exacto del reclamo; escrito en línea, PS-169).
          data: {
            labelProcessingSince: null,
            providerQuotationId: null,
            providerRateId: null,
            chosenRateJson: Prisma.DbNull,
            recommendedRateJson: Prisma.DbNull,
            rateChosenByUserId: null,
            rateChosenAt: null,
            packageCode: null,
            packageDimsJson: Prisma.DbNull,
            declaredValueCents: null,
            insuredValueCents: null,
          },
        });
        if (r.count !== 1) return false;
        const a = await tx.shipmentLabelAttempt.updateMany({
          where: { shipmentRequestId: shipmentId, since, outcome: 'pending', sentAt: via === 'auto_not_sent' ? null : { not: null } },
          data: { outcome: 'not_charged', outcomeReason: via === 'auto_not_sent' ? 'not_sent' : 'auto_verified', outcomeAt: now },
        });
        if (a.count !== 1) throw new ReleaseRaced();
        const quote = row.providerQuotationId
          ? await tx.shipmentQuote.findFirst({ where: { shipmentRequestId: shipmentId, providerQuotationId: row.providerQuotationId }, select: { id: true } })
          : null;
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            actorRole: null,
            action: 'shipment.label_released',
            entityType: 'ShipmentRequest',
            entityId: shipmentId,
            before: { labelProcessingSince: since.toISOString(), quoteId: quote?.id ?? null, rateId: row.providerRateId, priceCents: asRate(row.chosenRateJson)?.priceCents ?? null },
            after: { via, since: since.toISOString(), ...(clean ?? {}), actor: VERIFY_ACTOR },
            createdAt: now,
          },
        });
        return true;
      }, TX);
    } catch (e) {
      if (e instanceof ReleaseRaced) return false;
      throw e;
    }
  }

  /**
   * §19.27.4 paso 5 — `shipment.label_verify_uncertain {since, reason}` UNA vez por `since` (la lee `labelAlert.reason`).
   * `charged_not_found` ⇒ AG-9 (a) 🔴 con la MISMA llave que «Liberar» (`ag9:nf:<attemptId>`, §19.31.7 (c)).
   */
  async markUncertain(shipmentId: string, since: Date, reason: InFlightUncertainReason, candidates: number, now: Date): Promise<boolean> {
    const seen = await this.prisma.auditLog.findFirst({
      where: { entityId: shipmentId, action: 'shipment.label_verify_uncertain', after: { path: ['since'], equals: since.toISOString() } },
      select: { id: true },
    });
    if (seen) return false;
    await this.prisma.auditLog.create({
      data: {
        actorUserId: null,
        actorRole: null,
        action: 'shipment.label_verify_uncertain',
        entityType: 'ShipmentRequest',
        entityId: shipmentId,
        after: { since: since.toISOString(), reason, candidates, actor: VERIFY_ACTOR },
        createdAt: now,
      },
    });
    if (reason === 'charged_not_found') {
      const att = await this.prisma.shipmentLabelAttempt.findUnique({ where: { shipmentRequestId_since: { shipmentRequestId: shipmentId, since } } });
      if (att) {
        await this.alerts.raise(this.prisma, {
          kind: 'label_charged_unexplained',
          severity: 'immediate',
          dedupKey: `ag9:nf:${att.id}`,
          shipmentRequestId: shipmentId,
          amountCents: att.expectedChargeCents,
          facts: { cause: 'charged_not_found', expectedChargeCents: att.expectedChargeCents, providerReference: att.providerReference },
        }, now);
      }
    }
    return true;
  }

  /**
   * §19.28.4 + §19.29.4 — Skydropx creó DOS (o más) envíos con nuestro folio exacto para UN reclamo: doble cobro. Cada id va a
   * `shipment.label_orphan {cause:'duplicate'}` y a `ShipmentPaidLabel {origin:'duplicate', attemptId}` (una vez por id: el
   * `@unique` del libro), y el reclamo queda `uncertain('duplicate')`. La conciliación (§19.29.1.5) decide si se cancelan.
   */
  async recordDuplicates(shipmentId: string, since: Date, dups: readonly RecentProviderShipment[], now: Date): Promise<number> {
    const att = await this.prisma.shipmentLabelAttempt.findUnique({ where: { shipmentRequestId_since: { shipmentRequestId: shipmentId, since } } });
    if (!att) return 0;
    let n = 0;
    for (const d of dups) {
      const wrote = await this.prisma.$transaction(async (tx) => {
        const ins = await tx.shipmentPaidLabel.createMany({
          data: [{ providerShipmentId: d.providerShipmentId, shipmentRequestId: shipmentId, attemptId: att.id, origin: 'duplicate', chargedCents: att.expectedChargeCents }],
          skipDuplicates: true,
        });
        if (ins.count !== 1) return false;
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            actorRole: null,
            action: 'shipment.label_orphan',
            entityType: 'ShipmentRequest',
            entityId: shipmentId,
            after: { since: since.toISOString(), providerShipmentId: d.providerShipmentId, providerReference: att.providerReference, cause: 'duplicate', actor: VERIFY_ACTOR },
            createdAt: now,
          },
        });
        return true;
      }, TX);
      if (wrote) n += 1;
    }
    await this.markUncertain(shipmentId, since, 'duplicate', dups.length, now);
    return n;
  }

  /** §19.18.4 paso 2: `not_in_progress` ⇒ `has_provider_id` ⇒ `too_early {retryAfterSeconds}` (T_UNKNOWN, UNA constante). */
  private assertReleasable(row: ShipmentRequest, now: Date): void {
    if (row.labelProcessingSince === null) {
      throw new BusinessException('LABEL_NOT_RELEASABLE', 409, 'No purchase in progress', { reason: 'not_in_progress' });
    }
    if (row.providerShipmentId !== null) {
      throw new BusinessException('LABEL_NOT_RELEASABLE', 409, 'The label already has a provider id', { reason: 'has_provider_id' });
    }
    const readyAt = row.labelProcessingSince.getTime() + this.cfg.tUnknownMs;
    if (readyAt > now.getTime()) {
      throw new BusinessException('LABEL_NOT_RELEASABLE', 409, 'Too early to release', {
        reason: 'too_early',
        retryAfterSeconds: Math.max(1, Math.ceil((readyAt - now.getTime()) / 1000)),
      });
    }
  }

  /** El reclamo vigente, reconstruido de la fila y de su intento (la adopción no tiene cotización ni empaque). */
  private async claimOf(shipmentId: string, since: Date, db: Tx | PrismaService = this.prisma): Promise<PersistClaim | null> {
    const row = await db.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
    const att = await db.shipmentLabelAttempt.findUnique({ where: { shipmentRequestId_since: { shipmentRequestId: shipmentId, since } } });
    const rate = asRate(row.chosenRateJson) as ShipmentRateDTO | null;
    if (!att || !rate || row.labelProcessingSince?.getTime() !== since.getTime()) return null;
    return { since, attemptId: att.id, claimerId: att.actorUserId, rate, recommended: asRate(row.recommendedRateJson), row, folio: row.folio };
  }
}

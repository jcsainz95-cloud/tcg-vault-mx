/**
 * label-recovery.service.ts — 💰🔒 la compra en vuelo sin respuesta (API_CONTRACT §M4-SHIP.19.18.4, §19.26.3 (b) 5, §19.27.4–.6,
 * §19.28.4–.5, §19.29.1.3–.4, §19.29.4 tabla del libro).
 *
 *  - `recoverInFlightLabel(shipmentId, now)`: verificación de SOLO LECTURA. Llama **solo** `port.recentShipments`,
 *    `port.balance` y `port.getShipment` (⛔ `purchase`, `cancel`, `protect`: PS-117). Un cuerpo, dos llamadores: el job
 *    `shipment-label-processing` (D2d, sin construir) y `label/release`. Adopta **solo por folio exacto** (§19.28.4).
 *  - `POST /admin/shipments/:id/label/release` (solo `super_admin`, `@MoneyOut()`): guardas, `confirmConflict`, busca antes
 *    de liberar; `found` ⇒ adopta; si no ⇒ libera con el CAS de `since` exacto y la fila del intento (C-17).
 *
 * ⚠️ La evidencia negativa (lecturas limpias `label_verify_clean/dirty`, §19.27.4 paso 4 con §19.28.9) NO está construida:
 * con `INFLIGHT_NEGATIVE_VERIFIED = false` (el valor vigente) nunca decide; si una configuración la enciende, este cuerpo
 * la trata como `not_calibrated` y lo loguea (ver BACKEND_NOTES §62).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ProviderShipmentState, RecentProviderShipment } from '../shipping-provider/shipping-provider.port';
import { SpendAlertsService } from '../spend-alerts/spend-alerts.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { LabelActor, PersistClaim, ShipmentLabelService } from './label-purchase.service';
import { LABEL_VERIFY_CONFIG, LabelVerifyConfig, RECENT_DETAIL_MAX } from './label-verify.constants';
import { InFlightUncertainReason, asRate } from './label-view';
import { ShipmentRateDTO } from './label-dto';

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export type InFlightVerdict =
  | { outcome: 'found'; providerShipmentId: string }
  | { outcome: 'not_charged' }
  | { outcome: 'not_sent' }
  | { outcome: 'pending' }
  | { outcome: 'uncertain'; reason: InFlightUncertainReason };

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
   * §19.27.4 con §19.28.4/.5/.9 — UNA lectura. ⛔ Solo `recentShipments`, `balance`, `getShipment`. `found` trae el detalle
   * leído (para persistir sin una segunda lectura).
   */
  async recoverInFlightLabel(shipmentId: string, now: Date): Promise<{ verdict: InFlightVerdict; detail: ProviderShipmentState | null }> {
    const snap = await this.snapshot(shipmentId);
    if (!snap) return { verdict: { outcome: 'pending' }, detail: null };
    const { since, attempt } = snap;
    const age = now.getTime() - since.getTime();
    const late = age >= this.cfg.tUnknownMs;
    // §19.28.5 / C-16: sin `sentAt` (la compra NO salió) y pasada la vida máxima ⇒ `not_sent` (hecho local).
    if (!attempt?.sentAt) {
      return { verdict: age >= this.cfg.purchaseMaxLifeMs ? { outcome: 'not_sent' } : { outcome: 'pending' }, detail: null };
    }
    // Paso 1: un conflicto registrado ⇒ ni adopción ni liberación automáticas.
    if (snap.conflict) return { verdict: late ? { outcome: 'uncertain', reason: 'conflict' } : { outcome: 'pending' }, detail: null };

    const chosen = asRate(snap.row.chosenRateJson) as ShipmentRateDTO | null;
    const cp = typeof (snap.row.addressSnapshot as Record<string, unknown> | null)?.postalCode === 'string'
      ? String((snap.row.addressSnapshot as Record<string, unknown>).postalCode).trim()
      : null;
    let ambiguous = false;
    let unreadable = false;
    let candidates: RecentProviderShipment[] = [];

    // Paso 2–3: el listado y la adopción por folio exacto.
    try {
      const list = await this.selection.port.recentShipments(new Date(since.getTime() - this.cfg.tVerifySkewMs));
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
          if (!chosen || c.carrierName !== chosen.carrierName) continue;
          if (details >= RECENT_DETAIL_MAX) {
            unreadable = true; // más candidatos sin folio que lecturas ⇒ el listado no vota
            continue;
          }
          details += 1;
          try {
            const d = await this.selection.port.getShipment(c.providerShipmentId);
            withRef.push({ ...c, providerReference: d.providerReference ?? null, detail: d });
          } catch {
            unreadable = true;
          }
        }
        const ours = attempt.providerReference;
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
          return { verdict: { outcome: 'uncertain', reason: 'duplicate' }, detail: null };
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
              return { verdict: { outcome: 'found', providerShipmentId: c.providerShipmentId }, detail: d };
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

    // Paso 4 (evidencia negativa): NO construido — ver la cabecera. Con la constante en `false` nunca decide.
    if (this.cfg.negativeVerified) {
      this.logger.error(`inflight_negative_not_built shipmentId=${shipmentId}: la evidencia negativa no está construida; se trata como not_calibrated`);
    }
    if (!late) return { verdict: { outcome: 'pending' }, detail: null };

    // Paso 5: el motivo de la incertidumbre (precedencia: conflict > charged_not_found > ambiguous > balance_moved >
    // unreadable > not_calibrated).
    let delta: number | null = null;
    if (snap.balanceBeforeCents !== null) {
      try {
        const b = await this.selection.port.balance();
        delta = snap.balanceBeforeCents - b.balanceCents;
      } catch {
        unreadable = true;
      }
    } else {
      unreadable = true;
    }
    let reason: InFlightUncertainReason;
    if (delta !== null && delta === attempt.expectedChargeCents && candidates.length === 0) reason = 'charged_not_found';
    else if (ambiguous) reason = 'ambiguous';
    else if (delta !== null && delta !== 0) reason = 'balance_moved';
    else if (unreadable) reason = 'unreadable';
    else reason = 'not_calibrated';
    return { verdict: { outcome: 'uncertain', reason }, detail: null };
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

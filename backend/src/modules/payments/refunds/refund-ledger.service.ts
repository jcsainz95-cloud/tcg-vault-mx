/**
 * §M4-SHIP.2/.7/.8/.17.6 — EL LIBRO DE REEMBOLSOS `PaymentRefund` y la ÚNICA conversación con Stripe.
 *
 *  - `createRows(tx, …)`: las filas nacen `requested` DENTRO de la tx del acto que las origina, con su llave de
 *    negocio única (`item:<shipmentItemId>` · `order-rest:<orderId>` · `ship-fee:<shipmentRequestId>` ·
 *    `order-full:<orderId>` · `case:<caseId>`), componentes CONGELADOS y bitácora `payment_refund.requested`.
 *    ⛔ Sin `skipDuplicates`: bajo candado un duplicado es un defecto ⇒ `P2002` ⇒ `409 CONFLICT`.
 *    Candado `C-REF-1`: los ÚNICOS llamadores son el preparado, M3, el reembolso del apartado y
 *    `closeWithdrawalIfEmpty` (solo desde `refund`/`void` del apartado).
 *  - `executeRefund(fila)` (un cuerpo; lo llaman el post-commit del preparado/caso/M3 y `retry`):
 *    0. RECLAMO (lease, SEC-SHIP-M2) fuera de toda tx larga; 1. `attemptCount > 1` ⇒ búsqueda PAGINADA en
 *    Stripe por `metadata.paymentRefundId`; 2. si no ⇒ `refunds.create` con `amount` y la llave del libro;
 *    3. CAS `where { id, status:'requested' }` → `submitted|succeeded`; definitivo ⇒ `failed`; transitorio ⇒
 *    se queda `requested` y libera el reclamo. Para `order_full`, la tx de confirmación escribe también
 *    `Order → refunded` (`WHERE status IN (settled, refunded)`, SEC-SHIP-M5) y llama `onFullRefund` (§18.2).
 *  - `AV-12` post-commit, best-effort, con sello `customerNotifiedAt` reclamado por `updateMany`.
 *  - El TOPE del operador (§M4-SHIP.8): `lockOperatorRefundGate` + `usedCents` en 24 h rodantes.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MissingReason, PaymentRefund, PaymentRefundKind, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/business.exception';
import { RefundComponents } from '../../../common/money';
import { MAIL_PORT, MailPort } from '../../mail/mail.port';
import { StripeService } from '../stripe.service';
import { SettingsService } from '../../settings/settings.service';
import { SettingKey } from '../../settings/settings.constants';
import { readFrozenCardFacts } from '../../orders/order-item-card';
import { orderRefundedTemplate } from '../../orders/mail/order-notice.templates';
import { FullRefundService } from './full-refund.service';
import { Av12Params, refundNoticeTemplate } from './mail/refund-notice.templates';

/** Espacio del advisory lock de la PUERTA POR OPERADOR (§M4-SHIP.5 paso 6). Namespace propio. */
export const OPERATOR_REFUND_GATE_NAMESPACE = 80_125_061;
/** SEC-SHIP-M2: el reclamo del intento debe ser MAYOR que el timeout del cliente Stripe (prueba estática). */
export const REFUND_ATTEMPT_LEASE_MS = 5 * 60 * 1000;
/** Filas `requested` con más de esto ⇒ «atoradas» (`summary.stuckRefunds`). */
export const STUCK_REFUND_AFTER_MS = 10 * 60 * 1000;
/** Ventana rodante del tope del operador. */
export const OPERATOR_CAP_WINDOW_MS = 24 * 3600 * 1000;

export type Tx = Prisma.TransactionClient;

export interface NewRefundRow {
  idempotencyKey: string;
  kind: PaymentRefundKind;
  orderId?: string | null;
  shipmentRequestId?: string | null;
  orderItemId?: string | null;
  shipmentItemId?: string | null;
  missingReason?: MissingReason | null;
  components: RefundComponents;
  replacementCaseId?: string | null;
  reason?: string | null;
}

export interface RefundActor {
  id: string;
  role: Role;
}

export interface PaymentRefundDTO {
  id: string;
  kind: PaymentRefundKind;
  status: PaymentRefund['status'];
  amountCents: number;
  missingReason: MissingReason | null;
  requestedAt: string;
  requestedBy: { userId: string; name: string | null; role: Role };
  submittedAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
}

export type ExecuteOutcome =
  | { kind: 'done'; row: PaymentRefund }
  | { kind: 'in_progress'; attemptStartedAt: Date }
  | { kind: 'not_requested'; row: PaymentRefund };

/** Lo que el `WHERE` de todo lector de «no fallidas» comparte. */
export const NON_FAILED: Prisma.PaymentRefundWhereInput = { status: { not: 'failed' } };

@Injectable()
export class RefundLedgerService {
  private readonly logger = new Logger(RefundLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly settings: SettingsService,
    private readonly fullRefund: FullRefundService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  // ================================================================ el libro

  /** Nacen las filas `requested` + una bitácora `payment_refund.requested` por fila, DENTRO de la tx. */
  async createRows(
    tx: Tx,
    rows: NewRefundRow[],
    actor: RefundActor,
    extraAudit: Record<string, unknown> = {},
  ): Promise<PaymentRefund[]> {
    if (rows.length === 0) return [];
    for (const r of rows) {
      if (!Number.isInteger(r.components.amountCents) || r.components.amountCents <= 0) {
        throw new Error(`createRows: amountCents must be a positive integer (${r.idempotencyKey})`);
      }
    }
    await tx.paymentRefund.createMany({
      data: rows.map((r) => ({
        idempotencyKey: r.idempotencyKey,
        kind: r.kind,
        orderId: r.orderId ?? null,
        shipmentRequestId: r.shipmentRequestId ?? null,
        orderItemId: r.orderItemId ?? null,
        shipmentItemId: r.shipmentItemId ?? null,
        missingReason: r.missingReason ?? null,
        amountCents: r.components.amountCents,
        merchandiseCents: r.components.merchandiseCents,
        merchandiseIvaCents: r.components.merchandiseIvaCents,
        shippingCents: r.components.shippingCents,
        shippingIvaCents: r.components.shippingIvaCents,
        processingFeeCents: r.components.processingFeeCents,
        compensationCents: r.components.compensationCents,
        replacementCaseId: r.replacementCaseId ?? null,
        requestedByUserId: actor.id,
        requestedByRole: actor.role,
        reason: r.reason ?? null,
      })),
    });
    const created = await tx.paymentRefund.findMany({ where: { idempotencyKey: { in: rows.map((r) => r.idempotencyKey) } } });
    for (const row of created) {
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'payment_refund.requested',
          entityType: row.orderId ? 'Order' : 'ShipmentRequest',
          entityId: row.orderId ?? (row.shipmentRequestId as string),
          after: { refundId: row.id, kind: row.kind, amountCents: row.amountCents, actorRole: actor.role, ...extraAudit },
        },
      });
    }
    return created;
  }

  /** Σ `amountCents` de las filas NO fallidas de una orden (el remanente reembolsable es `total − esto`). */
  async refundedNonFailedCents(db: Tx | PrismaService, orderId: string): Promise<number> {
    const agg = await db.paymentRefund.aggregate({ where: { orderId, ...NON_FAILED }, _sum: { amountCents: true } });
    return agg._sum.amountCents ?? 0;
  }

  // ================================================================ el tope (§M4-SHIP.8)

  /** La PUERTA por operador: dos actos simultáneos del mismo operador no pasan los dos el tope. */
  async lockOperatorRefundGate(tx: Tx, actorUserId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OPERATOR_REFUND_GATE_NAMESPACE}::int, hashtext(${actorUserId}))`;
  }

  /** `usedCents` del tope: filas del actor, `kind ≠ order_full`, `status ≠ failed`, `createdAt > now − 24 h`. UN cuerpo. */
  async operatorUsedCents(db: Tx | PrismaService, actorUserId: string, now = new Date()): Promise<number> {
    const agg = await db.paymentRefund.aggregate({
      where: {
        requestedByUserId: actorUserId,
        kind: { not: 'order_full' },
        status: { not: 'failed' },
        createdAt: { gt: new Date(now.getTime() - OPERATOR_CAP_WINDOW_MS) },
      },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents ?? 0;
  }

  async operatorCapCents(): Promise<number> {
    return this.settings.getNumber(SettingKey.OPERATOR_REFUND_CAP_24H_CENTS);
  }

  /**
   * Comprueba el tope (solo `vault_operator`) BAJO la puerta. Lanza `403 MONEY_OUT_LIMIT_EXCEEDED` (el caller
   * hace rollback y, DESPUÉS, audita `money_out.limit_blocked`).
   */
  async assertOperatorCap(tx: Tx, actor: RefundActor, planCents: number): Promise<void> {
    if (actor.role !== 'vault_operator' || planCents <= 0) return;
    await this.lockOperatorRefundGate(tx, actor.id);
    const cap = await this.operatorCapCents();
    const used = await this.operatorUsedCents(tx, actor.id);
    if (used + planCents > cap) {
      throw BusinessException.forbidden('MONEY_OUT_LIMIT_EXCEEDED', 'Operator 24h refund cap exceeded', {
        capCents: cap,
        usedCents: used,
        requestedCents: planCents,
      });
    }
  }

  // ================================================================ Stripe (§M4-SHIP.7 / .17.6)

  /**
   * `executeRefund(fila)` — un cuerpo. Devuelve el estado final de la fila. NUNCA lanza por Stripe: un fallo
   * de Stripe no revierte el acto que creó la fila (queda `requested` o `failed`).
   */
  async executeRefund(refundId: string, actor: RefundActor | null): Promise<ExecuteOutcome> {
    const now = new Date();
    // 0. reclamo (lease) — FUERA de toda transacción larga.
    const claimed = await this.prisma.paymentRefund.updateMany({
      where: {
        id: refundId,
        status: 'requested',
        OR: [{ attemptStartedAt: null }, { attemptStartedAt: { lt: new Date(now.getTime() - REFUND_ATTEMPT_LEASE_MS) } }],
      },
      data: { attemptStartedAt: now, attemptCount: { increment: 1 } },
    });
    const row = await this.prisma.paymentRefund.findUniqueOrThrow({
      where: { id: refundId },
      include: {
        order: { select: { id: true, stripePaymentIntentId: true } },
        shipmentRequest: { select: { id: true, stripePaymentIntentId: true } },
      },
    });
    if (claimed.count !== 1) {
      if (row.status !== 'requested') return { kind: 'not_requested', row };
      return { kind: 'in_progress', attemptStartedAt: row.attemptStartedAt ?? now };
    }
    const paymentIntentId = row.shipmentRequest?.stripePaymentIntentId ?? row.order?.stripePaymentIntentId ?? null;
    if (!paymentIntentId) {
      const failed = await this.markFailed(row.id, 'no_payment_intent', actor);
      return { kind: 'done', row: failed };
    }
    try {
      let stripeId: string | null = null;
      let stripeStatus = 'pending';
      // 1. hubo un intento anterior que pudo llegar a Stripe ⇒ buscar (PAGINADO) antes de crear.
      if (row.attemptCount > 1) {
        const existing = (await this.stripe.listRefunds(paymentIntentId)).find((r) => r.metadata?.paymentRefundId === row.id);
        if (existing) {
          stripeId = existing.id;
          stripeStatus = existing.status;
        }
      }
      // 2. si no ⇒ crear con `amount` y la llave del libro.
      if (!stripeId) {
        const created = await this.stripe.createRefund({
          paymentIntentId,
          amountCents: row.amountCents,
          idempotencyKey: row.idempotencyKey,
          metadata: { paymentRefundId: row.id, key: row.idempotencyKey },
        });
        stripeId = created.id;
        stripeStatus = created.status;
      }
      // 3. CAS al libro (+ la tx de confirmación de `order_full`).
      return { kind: 'done', row: await this.applyStripeOutcome(row, stripeId, stripeStatus, actor) };
    } catch (e) {
      const { definitive, code } = StripeService.classifyRefundError(e);
      if (definitive) {
        this.logger.error(`Stripe rechazó el reembolso ${row.id} (${row.idempotencyKey}): ${code} — ${(e as Error).message}`);
        return { kind: 'done', row: await this.markFailed(row.id, code, actor) };
      }
      this.logger.warn(`Stripe transitorio en el reembolso ${row.id}: ${code} — ${(e as Error).message}; queda requested.`);
      // Error transitorio ⇒ libera el reclamo (el propio).
      await this.prisma.paymentRefund.updateMany({ where: { id: row.id, attemptStartedAt: now }, data: { attemptStartedAt: null } });
      return { kind: 'done', row: await this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: row.id } }) };
    }
  }

  /**
   * La tx de CONFIRMACIÓN: CAS de la fila `requested → submitted|succeeded`; si es `order_full` y el CAS ganó,
   * `Order → refunded` con `status IN (settled, refunded)` (`count 1` con `refunded` = ÉXITO: el webhook llegó
   * antes, SEC-SHIP-M5) y `onFullRefund(tx, { orderId }, 'm3', actor)`. `AV-3` lo manda quien escribió el sello.
   */
  private async applyStripeOutcome(
    row: PaymentRefund,
    stripeId: string,
    stripeStatus: string,
    actor: RefundActor | null,
  ): Promise<PaymentRefund> {
    const now = new Date();
    if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
      return this.markFailed(row.id, `stripe_${stripeStatus}`, actor, stripeId);
    }
    const succeeded = stripeStatus === 'succeeded';
    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.paymentRefund.updateMany({
        where: { id: row.id, status: 'requested' },
        data: {
          status: succeeded ? 'succeeded' : 'submitted',
          stripeRefundId: stripeId,
          submittedAt: now,
          ...(succeeded ? { succeededAt: now } : {}),
          attemptStartedAt: null,
        },
      });
      if (cas.count !== 1 || row.kind !== 'order_full' || !row.orderId) return { notify: false };
      // 🔒 v1.80.7 (§M4-SHIP.18.2 M5, punto 17 · techlead) — EL ORDEN DEL WEBHOOK, un solo orden en los dos escritores:
      // (2) lectura SIN candado del estado (∉ {settled, refunded} ⇒ log error, fin); (3) `onFullRefund` toma envíos →
      // piezas → `Order FOR UPDATE` y sella; (4) `Order → refunded` BAJO ese mismo candado. Antes (4) iba antes de (3):
      // esta tx sostenía `Order` mientras pedía el retiro, y `prepared` de un retiro (envío → piezas → `Order`) sostenía
      // el retiro mientras pedía `Order` ⇒ `40P01`. La caza: PS-57c (barrera en el retiro, N=10, `deadlocks` Δ=0).
      const o = await tx.order.findUniqueOrThrow({ where: { id: row.orderId }, select: { status: true } });
      if (o.status !== 'settled' && o.status !== 'refunded') {
        this.logger.error(`order_full ${row.id}: la orden ${row.orderId} está ${o.status}; la fila conserva su estado nuevo y la orden no se toca.`);
        return { notify: false };
      }
      await this.fullRefund.onFullRefund(tx, { orderId: row.orderId }, 'm3', actor?.id ?? null);
      // `Order → refunded` con `status IN (settled, refunded)`: `count 1` con la orden ya `refunded` es ÉXITO (el
      // webhook llegó antes, SEC-SHIP-M5). Quien hace la TRANSICIÓN `settled → refunded` manda `AV-3` (una vez).
      const transitioned = await tx.order.updateMany({
        where: { id: row.orderId, status: 'settled' },
        data: { status: 'refunded', refundedAt: now },
      });
      if (transitioned.count === 0) {
        const after = await tx.order.findUniqueOrThrow({ where: { id: row.orderId }, select: { status: true } });
        if (after.status !== 'refunded') {
          this.logger.error(`order_full ${row.id}: la orden ${row.orderId} pasó a ${after.status} bajo candado; la fila conserva su estado nuevo y la orden no se toca.`);
          return { notify: false };
        }
      }
      return { notify: transitioned.count === 1 };
    });
    if (result.notify && row.orderId) await this.sendOrderRefundedNotice(row.orderId);
    // PROJECTION-EXEMPT: fila INTERNA del libro; todo caller proyecta con `toDtos` antes de responder.
    return this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: row.id } });
  }

  private async markFailed(refundId: string, code: string, actor: RefundActor | null, stripeId?: string): Promise<PaymentRefund> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.paymentRefund.updateMany({
        where: { id: refundId, status: 'requested' },
        data: { status: 'failed', failureCode: code, failedAt: now, attemptStartedAt: null, ...(stripeId ? { stripeRefundId: stripeId } : {}) },
      });
      if (cas.count !== 1) return;
      const row = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refundId } });
      await tx.auditLog.create({
        data: {
          actorUserId: actor?.id ?? null,
          actorRole: actor?.role ?? null,
          action: 'payment_refund.failed',
          entityType: row.orderId ? 'Order' : 'ShipmentRequest',
          entityId: row.orderId ?? (row.shipmentRequestId as string),
          after: { refundId, kind: row.kind, amountCents: row.amountCents, failureCode: code },
        },
      });
    });
    // PROJECTION-EXEMPT: fila INTERNA del libro; todo caller proyecta con `toDtos` antes de responder.
    return this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: refundId } });
  }

  /**
   * §9 (v1.80) — `charge.refund.updated` / `refund.updated`: concilia UNA fila por `metadata.paymentRefundId`.
   * `succeeded` ⇒ `submitted|requested → succeeded`; `failed|canceled` ⇒ `→ failed`. Sin metadata ⇒ solo log.
   */
  async onRefundUpdated(refund: { id: string; status: string | null; metadata?: Record<string, string> | null }): Promise<void> {
    const refundId = refund.metadata?.paymentRefundId;
    if (!refundId) {
      this.logger.log(`refund.updated ${refund.id} sin metadata.paymentRefundId (hecho en el panel de Stripe): sin conciliar.`);
      return;
    }
    const now = new Date();
    if (refund.status === 'succeeded') {
      await this.prisma.paymentRefund.updateMany({
        where: { id: refundId, status: { in: ['requested', 'submitted'] } },
        data: { status: 'succeeded', stripeRefundId: refund.id, submittedAt: now, succeededAt: now, attemptStartedAt: null },
      });
      return;
    }
    if (refund.status === 'failed' || refund.status === 'canceled') {
      const row = await this.prisma.paymentRefund.findUnique({ where: { id: refundId } });
      if (!row || row.status === 'failed' || row.status === 'succeeded') return;
      this.logger.error(`Stripe marcó ${refund.status} el reembolso ${refundId} (${refund.id}).`);
      await this.prisma.$transaction(async (tx) => {
        const cas = await tx.paymentRefund.updateMany({
          where: { id: refundId, status: { in: ['requested', 'submitted'] } },
          data: { status: 'failed', failureCode: `stripe_${refund.status}`, failedAt: now, attemptStartedAt: null },
        });
        if (cas.count !== 1) return;
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            actorRole: null,
            action: 'payment_refund.failed',
            entityType: row.orderId ? 'Order' : 'ShipmentRequest',
            entityId: row.orderId ?? (row.shipmentRequestId as string),
            after: { refundId, kind: row.kind, amountCents: row.amountCents, failureCode: `stripe_${refund.status}`, stripeRefundId: refund.id },
          },
        });
      });
    }
  }

  // ================================================================ retry (§M4-SHIP.5)

  /** `POST /admin/refunds/:id/retry` — solo `requested`; el operador no reintenta `order_full` ni `case_refund`. */
  async retry(refundId: string, actor: RefundActor): Promise<PaymentRefundDTO> {
    const row = await this.prisma.paymentRefund.findUnique({ where: { id: refundId } });
    if (!row) throw BusinessException.notFound();
    if (actor.role !== 'super_admin' && (row.kind === 'order_full' || row.kind === 'case_refund')) {
      throw BusinessException.forbidden('MONEY_OUT_FORBIDDEN', 'Only super_admin may retry this refund');
    }
    if (row.status !== 'requested') {
      throw BusinessException.conflict('REFUND_NOT_RETRYABLE', 'Refund is not retryable', { status: row.status });
    }
    const outcome = await this.executeRefund(refundId, actor);
    if (outcome.kind === 'in_progress') {
      throw BusinessException.conflict('REFUND_ATTEMPT_IN_PROGRESS', 'Another attempt is talking to Stripe', {
        attemptStartedAt: outcome.attemptStartedAt.toISOString(),
      });
    }
    if (outcome.kind === 'not_requested') {
      throw BusinessException.conflict('REFUND_NOT_RETRYABLE', 'Refund is not retryable', { status: outcome.row.status });
    }
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'payment_refund.retry',
        entityType: row.orderId ? 'Order' : 'ShipmentRequest',
        entityId: row.orderId ?? (row.shipmentRequestId as string),
        after: { refundId, status: outcome.row.status },
      },
    });
    await this.notifyCustomer([refundId]);
    return (await this.toDtos([outcome.row]))[0];
  }

  /** Post-commit del preparado / caso: ejecuta cada fila nueva y luego avisa (`AV-12`). Best-effort. */
  async executeAndNotify(refundIds: string[], actor: RefundActor | null): Promise<PaymentRefund[]> {
    const rows: PaymentRefund[] = [];
    for (const id of refundIds) {
      try {
        const o = await this.executeRefund(id, actor);
        if (o.kind === 'in_progress') this.logger.warn(`executeRefund ${id}: otro intento lo tiene; se omite.`);
        rows.push(o.kind === 'in_progress' ? await this.prisma.paymentRefund.findUniqueOrThrow({ where: { id } }) : o.row);
      } catch (e) {
        this.logger.error(`executeRefund ${id} falló: ${(e as Error).message}`);
        rows.push(await this.prisma.paymentRefund.findUniqueOrThrow({ where: { id } }));
      }
    }
    await this.notifyCustomer(refundIds);
    return rows;
  }

  // ================================================================ AV-12 / AV-3

  /**
   * `AV-12` — se RECLAMAN las filas `submitted|succeeded` sin sello y se manda UN correo con las reclamadas.
   * ⛔ Nunca de una fila que Stripe no aceptó. Post-commit, best-effort, jamás propaga.
   */
  async notifyCustomer(refundIds: string[]): Promise<void> {
    if (refundIds.length === 0) return;
    try {
      if (!this.mail) return;
      const now = new Date();
      const claimed = await this.prisma.paymentRefund.updateMany({
        where: { id: { in: refundIds }, status: { in: ['submitted', 'succeeded'] }, customerNotifiedAt: null },
        data: { customerNotifiedAt: now },
      });
      if (claimed.count === 0) return;
      const rows = await this.prisma.paymentRefund.findMany({
        where: { id: { in: refundIds }, customerNotifiedAt: now },
        include: {
          orderItem: { select: { cardSnapshot: true } },
          replacementCase: { select: { customerUserId: true, originalInventoryItem: { select: { card: { select: { name: true, set: { select: { name: true } } } } } } } },
          order: { select: { id: true, orderNumber: true, guestEmail: true, locale: true, userId: true } },
          shipmentRequest: { select: { id: true, userId: true } },
        },
      });
      if (rows.length === 0) return;
      // UN correo por DESTINATARIO y acto (§M4-SHIP.15.7): el `case_refund` y la `shipment_fee` del cierre de su
      // retiro van en el MISMO aviso («no pudimos reponer tu carta… y tu retiro no sale»).
      const groups = new Map<string, { recipient: { email: string; locale: string | null }; rows: typeof rows }>();
      for (const r of rows) {
        const recipient = await this.recipientOf(r);
        if (!recipient) {
          this.logger.warn(`AV-12 omitido para ${r.id}: sin destinatario`);
          continue;
        }
        const g = groups.get(recipient.email) ?? { recipient, rows: [] };
        g.rows.push(r);
        groups.set(recipient.email, g);
      }
      for (const [, { recipient, rows: group }] of groups) {
        const first = group.find((r) => r.orderId) ?? group[0];
        const key = first.orderId ?? (first.shipmentRequestId as string);
        const nothingShips = group.some((r) => r.kind === 'order_remaining' || r.kind === 'shipment_fee');
        const isCase = group.some((r) => r.kind === 'case_refund');
        const cards = group
          .filter((r) => r.kind === 'item_missing' || r.kind === 'case_refund')
          .map((r) => {
            const facts = r.orderItem ? readFrozenCardFacts(r.orderItem.cardSnapshot) : null;
            const fromCase = r.replacementCase?.originalInventoryItem.card;
            return {
              name: facts?.name ?? fromCase?.name ?? '',
              setName: facts?.setName ?? fromCase?.set?.name ?? null,
              reason: r.missingReason ?? null,
              amountCents: r.amountCents,
            };
          });
        const params: Av12Params = {
          reference: first.order?.orderNumber ?? first.shipmentRequestId ?? key,
          orderId: first.order?.id ?? null,
          orderNumber: first.order?.orderNumber ?? null,
          cards,
          nothingShips,
          variant: isCase ? 'case_refund' : 'item_missing',
          totalCents: group.reduce((a, r) => a + r.amountCents, 0),
        };
        await this.mail.send({ ...refundNoticeTemplate(params, recipient.locale), to: recipient.email });
      }
    } catch (e) {
      this.logger.error(`AV-12 falló: ${(e as Error).message}`);
    }
  }

  /** §R.5 — `guestEmail ?? User.email` de la orden; en un retiro, el dueño del retiro; en un caso, su cliente. */
  private async recipientOf(row: {
    order: { guestEmail: string | null; locale: string | null; userId: string | null } | null;
    shipmentRequest: { userId: string | null } | null;
    replacementCase: { customerUserId: string } | null;
  }): Promise<{ email: string; locale: string | null } | null> {
    if (row.order?.guestEmail) return { email: row.order.guestEmail, locale: row.order.locale };
    const userId = row.replacementCase?.customerUserId ?? row.shipmentRequest?.userId ?? row.order?.userId ?? null;
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, locale: true, anonymizedAt: true } });
    if (!user || user.anonymizedAt) return null;
    return { email: user.email, locale: row.order?.locale ?? user.locale };
  }

  /**
   * §9 (v1.80) regla de `AV-3`: sale SOLO si la orden tiene una fila `order_full` no fallida, o NINGUNA fila
   * del libro (reembolso hecho fuera del sistema). Con filas `item_missing`/`order_remaining` el cliente ya
   * recibió `AV-12`.
   */
  async av3Allowed(orderId: string): Promise<boolean> {
    const rows = await this.prisma.paymentRefund.findMany({ where: { orderId }, select: { kind: true, status: true } });
    if (rows.length === 0) return true;
    return rows.some((r) => r.kind === 'order_full' && r.status !== 'failed');
  }

  /** `AV-3` (con su variante `vault`, §R.3) — post-commit, best-effort. Lo manda quien escribió el sello. */
  async sendOrderRefundedNotice(orderId: string): Promise<void> {
    try {
      if (!this.mail) return;
      if (!(await this.av3Allowed(orderId))) return;
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { orderNumber: true, totalCents: true, guestEmail: true, locale: true, userId: true, fulfillmentMode: true },
      });
      if (!order) return;
      const recipient = order.guestEmail
        ? { email: order.guestEmail, locale: order.locale }
        : await this.prisma.user
            .findUnique({ where: { id: order.userId ?? '' }, select: { email: true, locale: true, anonymizedAt: true } })
            .then((u) => (u && !u.anonymizedAt ? { email: u.email, locale: order.locale ?? u.locale } : null));
      if (!recipient) {
        this.logger.warn(`AV-3 omitido para ${orderId}: sin destinatario`);
        return;
      }
      await this.mail.send({
        ...orderRefundedTemplate(
          { orderId, orderNumber: order.orderNumber ?? '', totalCents: order.totalCents, vault: order.fulfillmentMode === 'vault' },
          recipient.locale,
        ),
        to: recipient.email,
      });
    } catch (e) {
      this.logger.error(`AV-3 falló para ${orderId}: ${(e as Error).message}`);
    }
  }

  // ================================================================ proyección

  async toDtos(rows: PaymentRefund[]): Promise<PaymentRefundDTO[]> {
    const ids = [...new Set(rows.map((r) => r.requestedByUserId))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name.trim() === '' ? null : u.name]));
    return rows.map((r) => RefundLedgerService.toDto(r, names.get(r.requestedByUserId) ?? null));
  }

  static toDto(r: PaymentRefund, requesterName: string | null): PaymentRefundDTO {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      amountCents: r.amountCents,
      missingReason: r.missingReason,
      requestedAt: r.createdAt.toISOString(),
      requestedBy: { userId: r.requestedByUserId, name: requesterName, role: r.requestedByRole },
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      succeededAt: r.succeededAt ? r.succeededAt.toISOString() : null,
      failedAt: r.failedAt ? r.failedAt.toISOString() : null,
      failureCode: r.failureCode,
    };
  }

  /** `summary.stuckRefunds`: `requested` con más de 10 min, o `failed`. UN cuerpo con el tablero. */
  async stuckRefundsCount(now = new Date()): Promise<number> {
    return this.prisma.paymentRefund.count({
      where: {
        OR: [
          { status: 'requested', createdAt: { lt: new Date(now.getTime() - STUCK_REFUND_AFTER_MS) } },
          { status: 'failed' },
        ],
      },
    });
  }
}

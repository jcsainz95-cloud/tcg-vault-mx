/**
 * 💰 v1.82 (API_CONTRACT §PNL.3, ARCHITECTURE §4.61.3) — RETIRO DE BÓVEDA ENTREGADO: devolver UNA carta por SPEI.
 *
 * `POST /api/v1/admin/manual-refunds/withdrawal-delivered` (`super_admin`, `@MoneyOut`) y su previsualización
 * `GET …/withdrawal-delivered/preview?shipmentItemId=…&amountCents=A`. El monto LO CAPTURA el dueño (`HECHOS.md:31` (b)),
 * con las MISMAS referencias y topes de dedo que el reembolso de un caso «Por reponer» (`refund-reference.ts`, D-12,
 * `HECHOS.md:32`). Nace una `ManualRefund { source: 'withdrawal_delivered', replacementCaseId: null }` en la cubeta SPEI
 * existente (pagar / cancelar / re-emitir y AV-14 sin cambio). ⛔ Cero Stripe, cero `PaymentRefund`, cero inventario (la
 * carta la tiene el cliente).
 *
 * Algoritmo (el verbo, bajo candado; la preview, el mismo cuerpo sin candado ni escrituras):
 *  1. `400` de forma; línea inexistente ⇒ `404`.
 *  2. `$transaction`; `ShipmentRequest` de la línea `FOR UPDATE`.
 *  3. ⇒ `409 ITEM_REFUND_NOT_AVAILABLE {reason}` (la primera): `userId IS NULL` ⇒ `not_withdrawal` (un directo: su vía es
 *     §PNL.2) · `status ≠ entregado` ⇒ `not_delivered` · `prepStatus = missing` o la línea abrió un caso ⇒ `not_shipped` ·
 *     una `ManualRefund` VIVA de esa línea ⇒ `already_refunded` + `manualRefundId`.
 *  4. Referencias: origen = `resolveOrigin(pieza, userId)`; `Q` del origen (`null` sin origen o `IVA_EXCLUSIVE`);
 *     `M = marketRefOf(pieza)`; `R = max(Q ?? 0, M ?? 0)`; `R = 0` ⇒ `no_reference`.
 *  5. Topes `2R` (`confirmAboveReference`) y `kR` (dial) con los códigos de siempre.
 *  6. Componentes: con origen usable ⇒ `caseRefundComponents(A)`; si no ⇒ todo `compensationCents = A`.
 *  7. Fila `withdrawal-delivered:<id>`; la unicidad de negocio es el índice parcial «una viva por línea» (M-70);
 *     `P2002` ⇒ `409 … already_refunded`.
 *  8. Bitácora `manual_refund.withdrawal_delivered_created` en la tx. 9. Post-commit AV-14.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ManualRefund, Prisma, Role, ShippedRefundReason } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/business.exception';
import { ACCEPTED_SHIPPED_REFUND_REASONS } from '../../../common/business-rules';
import { CaseRefundContext, MAX_CENTS, RefundComponents, caseRefundComponents, caseRefundContextOf, ivaIsIncluded } from '../../../common/money';
import { SettingsService } from '../../settings/settings.service';
import { SettingKey } from '../../settings/settings.constants';
import { VaultService } from '../../vault/vault.service';
import { ManualRefundDTO, ManualRefundService } from './manual-refund.service';
import { resolveOrigin } from './origin';
import { RefundConfirmation, RefundReference, assertCapturedAmountWithinLimits, refundConfirmationOf, refundReferenceOf } from './refund-reference';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export const WITHDRAWAL_DELIVERED_NOTE_MIN = 3;
export const WITHDRAWAL_DELIVERED_NOTE_MAX = 500;

export type WithdrawalDeliveredBlock = 'not_withdrawal' | 'not_delivered' | 'not_shipped' | 'already_refunded' | 'no_reference';

export interface WithdrawalDeliveredBody {
  shipmentItemId: string;
  reason: ShippedRefundReason;
  note: string;
  amountCents: number;
  confirmAboveReference?: boolean;
}

/** El subconjunto de `CaseRefundPreviewDTO` sin las cifras de Stripe (§PNL.3). */
export interface WithdrawalDeliveredPreviewDTO {
  amountCents: number | null;
  paidReferenceCents: number | null;
  market: { cents: number; capturedDate: string } | null;
  referenceCents: number;
  confirmAboveCents: number;
  limitCents: number;
  confirmation: RefundConfirmation | null;
}

const LINE_SELECT = {
  id: true,
  shipmentRequestId: true,
  inventoryItemId: true,
  prepStatus: true,
  replacementCase: { select: { id: true } },
  shipmentRequest: { select: { id: true, userId: true, status: true } },
  inventoryItem: { include: { card: { include: { set: true } } } },
} satisfies Prisma.ShipmentItemSelect;
type LineRow = Prisma.ShipmentItemGetPayload<{ select: typeof LINE_SELECT }>;

interface Plan {
  ref: RefundReference;
  ctx: CaseRefundContext | null;
  originOrderId: string | null;
  customerUserId: string;
}

@Injectable()
export class WithdrawalDeliveredRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly vault: VaultService,
    private readonly manual: ManualRefundService,
  ) {}

  // ---------------------------------------------------------------- forma

  static parseBody(body: unknown): WithdrawalDeliveredBody {
    const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    if (typeof raw.shipmentItemId !== 'string' || raw.shipmentItemId.trim() === '' || raw.shipmentItemId.length > 64) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'shipmentItemId is required', { field: 'shipmentItemId' });
    }
    if (typeof raw.reason !== 'string' || !(ACCEPTED_SHIPPED_REFUND_REASONS as readonly string[]).includes(raw.reason)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid reason', { field: 'reason', allowed: [...ACCEPTED_SHIPPED_REFUND_REASONS] });
    }
    const note = typeof raw.note === 'string' ? raw.note.trim() : null;
    if (note === null || note.length < WITHDRAWAL_DELIVERED_NOTE_MIN || note.length > WITHDRAWAL_DELIVERED_NOTE_MAX) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `note must be ${WITHDRAWAL_DELIVERED_NOTE_MIN}–${WITHDRAWAL_DELIVERED_NOTE_MAX} characters`, {
        field: 'note',
        min: WITHDRAWAL_DELIVERED_NOTE_MIN,
        max: WITHDRAWAL_DELIVERED_NOTE_MAX,
      });
    }
    const a = raw.amountCents;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > MAX_CENTS) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'amountCents must be an integer between 1 and 2147483647', { field: 'amountCents' });
    }
    if (raw.confirmAboveReference !== undefined && typeof raw.confirmAboveReference !== 'boolean') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'confirmAboveReference must be a boolean', { field: 'confirmAboveReference' });
    }
    return {
      shipmentItemId: raw.shipmentItemId,
      reason: raw.reason as ShippedRefundReason,
      note,
      amountCents: a,
      ...(raw.confirmAboveReference !== undefined ? { confirmAboveReference: raw.confirmAboveReference as boolean } : {}),
    };
  }

  private static parseAmountQuery(amountRaw: string | undefined): number | null {
    if (amountRaw === undefined || amountRaw === '') return null;
    const n = Number(amountRaw);
    if (!/^\d+$/.test(amountRaw) || !Number.isInteger(n) || n < 1 || n > MAX_CENTS) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'amountCents must be a positive integer', { field: 'amountCents' });
    }
    return n;
  }

  // ---------------------------------------------------------------- el cuerpo común (pasos 3–4)

  private blocked(reason: WithdrawalDeliveredBlock, extra: Record<string, unknown> = {}): BusinessException {
    return BusinessException.conflict('ITEM_REFUND_NOT_AVAILABLE', 'This card cannot be returned by SPEI', { reason, ...extra });
  }

  private loadLine(db: Db, shipmentItemId: string): Promise<LineRow | null> {
    return db.shipmentItem.findUnique({ where: { id: shipmentItemId }, select: LINE_SELECT });
  }

  /** Paso 3 — las guardas, la primera que falle. */
  private async assertEligible(db: Db, line: LineRow): Promise<string> {
    const userId = line.shipmentRequest.userId;
    if (!userId) throw this.blocked('not_withdrawal');
    if (line.shipmentRequest.status !== 'entregado') throw this.blocked('not_delivered');
    if (line.prepStatus === 'missing' || line.replacementCase) throw this.blocked('not_shipped');
    const live = await db.manualRefund.findFirst({ where: { shipmentItemId: line.id, status: { not: 'cancelled' } }, select: { id: true } });
    if (live) throw this.blocked('already_refunded', { manualRefundId: live.id });
    return userId;
  }

  /** Paso 4 — `Q`, `M`, `R`, `2R`, `kR` (un cuerpo con «Por reponer»). `R = 0` ⇒ `no_reference`. */
  private async planOf(db: Db, line: LineRow, customerUserId: string): Promise<Plan> {
    const origin = await resolveOrigin(db, customerUserId, line.inventoryItemId);
    let ctx: CaseRefundContext | null = null;
    if (origin) {
      const order = await db.order.findUniqueOrThrow({
        where: { id: origin.orderId },
        select: { subtotalCents: true, shippingFeeCents: true, processingFeeCents: true, ivaCents: true, ivaRatePct: true, totalCents: true, priceConvention: true },
      });
      if (ivaIsIncluded(order.priceConvention)) ctx = caseRefundContextOf(order, origin.unitPriceCents);
    }
    const market = await this.vault.marketRefOf(line.inventoryItem);
    const k = await this.settings.getNumber(SettingKey.CASE_REFUND_HARD_MULTIPLIER, db);
    const ref = refundReferenceOf(ctx?.paidCents ?? null, market, k);
    if (ref.referenceCents <= 0) throw this.blocked('no_reference');
    return { ref, ctx, originOrderId: origin?.orderId ?? null, customerUserId };
  }

  /** Paso 6 — con origen usable, el reparto de «Por reponer»; sin él, todo es compensación (sin IVA de venta). */
  private static componentsOf(a: number, ctx: CaseRefundContext | null): RefundComponents {
    if (ctx) return caseRefundComponents(a, ctx);
    return { amountCents: a, merchandiseCents: 0, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: a };
  }

  // ---------------------------------------------------------------- preview

  async preview(shipmentItemId: string | undefined, amountRaw: string | undefined): Promise<WithdrawalDeliveredPreviewDTO> {
    if (typeof shipmentItemId !== 'string' || shipmentItemId.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'shipmentItemId is required', { field: 'shipmentItemId' });
    }
    const amountCents = WithdrawalDeliveredRefundService.parseAmountQuery(amountRaw);
    const line = await this.loadLine(this.prisma, shipmentItemId);
    if (!line) throw BusinessException.notFound('NOT_FOUND', 'Shipment line not found');
    const customerUserId = await this.assertEligible(this.prisma, line);
    const { ref } = await this.planOf(this.prisma, line, customerUserId);
    return {
      amountCents,
      paidReferenceCents: ref.paidReferenceCents,
      market: ref.market,
      referenceCents: ref.referenceCents,
      confirmAboveCents: ref.confirmAboveCents,
      limitCents: ref.limitCents,
      confirmation: amountCents === null ? null : refundConfirmationOf(amountCents, ref),
    };
  }

  // ---------------------------------------------------------------- el verbo

  async create(rawBody: unknown, actor: { id: string; role: Role }): Promise<{ manualRefund: ManualRefundDTO }> {
    const body = WithdrawalDeliveredRefundService.parseBody(rawBody);
    const head = await this.prisma.shipmentItem.findUnique({ where: { id: body.shipmentItemId }, select: { shipmentRequestId: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Shipment line not found');
    let created: ManualRefund;
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          // 2. el retiro de la línea, FOR UPDATE (serializa dos capturas de la misma línea y con los verbos del envío).
          await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${head.shipmentRequestId} FOR UPDATE`;
          const line = (await this.loadLine(tx, body.shipmentItemId)) as LineRow;
          // 3. guardas BAJO candado.
          const customerUserId = await this.assertEligible(tx, line);
          // 4–5. referencias y topes.
          const plan = await this.planOf(tx, line, customerUserId);
          const confirmation = assertCapturedAmountWithinLimits(body.amountCents, plan.ref, body.confirmAboveReference);
          // 6–7. la fila SPEI (la llave lleva su propio id).
          const id = randomUUID();
          const row = await this.manual.createRow(
            tx,
            {
              id,
              source: 'withdrawal_delivered',
              idempotencyKey: `withdrawal-delivered:${id}`,
              customerUserId,
              replacementCaseId: null,
              paymentRefundId: null,
              orderId: plan.originOrderId,
              shipmentItemId: line.id,
              deliveredReason: body.reason,
              deliveredNote: body.note,
              components: WithdrawalDeliveredRefundService.componentsOf(body.amountCents, plan.ctx),
            },
            actor,
            // 8. bitácora del acto (una fila, en la tx).
            {
              manualRefundId: id,
              shipmentId: line.shipmentRequestId,
              shipmentItemId: line.id,
              inventoryItemId: line.inventoryItemId,
              reason: body.reason,
              note: body.note,
              referenceCents: plan.ref.referenceCents,
              aboveRefConfirmed: confirmation === 'reinforced',
            },
            'manual_refund.withdrawal_delivered_created',
          );
          return row;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (e) {
      // Otra pestaña ganó «una viva por línea» (índice parcial de M-70) ⇒ 409 con la fila viva, ⛔ nunca 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const live = await this.prisma.manualRefund.findFirst({ where: { shipmentItemId: body.shipmentItemId, status: { not: 'cancelled' } }, select: { id: true } });
        throw this.blocked('already_refunded', live ? { manualRefundId: live.id } : {});
      }
      throw e;
    }
    // 9. post-commit: AV-14 (sello `announcedNotifiedAt`), best-effort.
    await this.manual.notifyAnnounced([created.id]);
    return { manualRefund: await this.manual.get(created.id) };
  }
}

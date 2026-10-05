/**
 * §M4-SHIP.15.13 / §M4-SHIP.17.3 / .17.4 / .17.8 — la cubeta «Reembolsos manuales (SPEI)» (v1.80.2…v1.80.3).
 *
 * Lo que el dueño DEBE transferir a mano y el registro de que lo hizo. ⛔ El sistema no transfiere. ⛔ `ManualRefund`
 * no copia la CLABE, el nombre ni el correo: guarda `customerUserId` y los lee VIVOS al proyectar; al pagar congela
 * `paidClabeHmac` (el índice ciego vigente) para poder probar después A QUÉ CLABE se pagó sin guardarla.
 *
 * Candado `C-MREF-1`: los ÚNICOS creadores de filas son `POST /admin/replacement-cases/:id/refund` (vía
 * `createRow`), `POST /admin/refunds/:id/to-manual`, `POST /admin/manual-refunds/:id/reissue` y (v1.82, §PNL.3)
 * `POST /admin/manual-refunds/withdrawal-delivered` (`WithdrawalDeliveredRefundService`); los únicos escritores
 * de `status:'paid'|'cancelled'` son `paid` y `cancel`. Todos `@MoneyOut()` (solo `super_admin`). El único lector de
 * `KycProfile.clabeEnc` que devuelve la CLABE en claro fuera de buylist es `reveal-clabe` (auditado, `no-store`).
 *
 * Orden de candados (§M4-SHIP.17.3): `ManualRefund` → `KycProfile` → `Order` (compartido). `setClabe` solo toma
 * `KycProfile`; el reembolso del caso crea la fila (no bloquea una existente) ⇒ sin ciclo.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { customerEmailOrBlank } from '../../../common/customer-email';
import { ManualRefund, ManualRefundSource, ManualRefundStatus, OrderStatus, Prisma, ReplacementCaseSource, Role, ShippedRefundReason } from '@prisma/client';
import { MANUAL_REFUND_STATUS_VALUES } from '../../../common/enum-values';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/business.exception';
import { PiiCryptoService } from '../../../common/crypto/pii-crypto.service';
import { maskClabe } from '../../../common/crypto/pii-mask';
import { RefundComponents } from '../../../common/money';
import { parseAdminListFilters } from '../../../common/admin-list-filters';
import { parseEnumFilter } from '../../../common/enum-filter';
import { MAIL_PORT, MailPort } from '../../mail/mail.port';
import { PreparationCardDTO, nullIfBlank, preparationCardOf } from '../../shipments/preparation-view';
import { customerDisplayName } from '../../vault/customer-display-name';
import { CLABE_RECENT_CHANGE_MS, REFUND_FAILURE_DISPUTE_CODES } from '../../vault/replacement-case.rules';
import { manualRefundAnnouncedTemplate, manualRefundPaidTemplate } from './mail/refund-notice.templates';
import type { CustomerRefDTO } from '../../shipments/shipment-prep.service';

type Tx = Prisma.TransactionClient;

/** Dominio de `revealToken` (§M4-SHIP.17.3 (3)): la MISMA llave del índice ciego, separada por prefijo. ⛔ Nada persistido. */
export const MANUAL_REFUND_REVEAL_DOMAIN = 'mr-reveal:v1:';

const STATUS_VALUES: readonly ManualRefundStatus[] = MANUAL_REFUND_STATUS_VALUES;

export interface ManualRefundDTO {
  id: string;
  source: ManualRefundSource;
  status: ManualRefundStatus;
  amountCents: number;
  components: { merchandiseCents: number; merchandiseIvaCents: number; processingFeeCents: number; compensationCents: number };
  customer: CustomerRefDTO;
  beneficiaryName: string | null;
  clabeOnFile: boolean;
  clabeMasked: string | null;
  clabeUpdatedAt: string | null;
  clabeChangedRecently: boolean;
  /** ⚠️ v1.82: `null` ⇔ `source = withdrawal_delivered` (no nace de un caso «Por reponer»). */
  case: { id: string; source: ReplacementCaseSource; card: PreparationCardDTO; folio: string; reason: string } | null;
  /** 💰 v1.82 (§PNL.3): solo `withdrawal_delivered` (si no, `null`): de qué retiro entregado y qué carta sale este SPEI. */
  withdrawal: {
    shipmentId: string;
    shipmentItemId: string;
    card: PreparationCardDTO;
    folio: string;
    reason: ShippedRefundReason;
    note: string;
    deliveredAt: string | null;
  } | null;
  origin: { orderId: string; orderNumber: string | null; orderStatus: OrderStatus } | null;
  paymentRefundId: string | null;
  createdAt: string;
  createdBy: { userId: string; name: string | null };
  paidAt: string | null;
  paidBy: { userId: string; name: string | null } | null;
  speiReference: string | null;
  paidNote: string | null;
  paidToCurrentClabe: boolean | null;
  cancelledAt: string | null;
  cancelledBy: { userId: string; name: string | null } | null;
  cancelNote: string | null;
  reissuedFromId: string | null;
  reissuedAsId: string | null;
}

export interface NewManualRefund {
  /** v1.82 (§PNL.3): el id se fija ANTES cuando la llave lo incluye (`withdrawal-delivered:<id>`). */
  id?: string;
  source: ManualRefundSource;
  idempotencyKey: string;
  customerUserId: string;
  /** ⇔ `source ∈ {case_excess, stripe_failed}` (CHECK `ManualRefund_case_sources_chk`, M-70). */
  replacementCaseId: string | null;
  /** v1.82 (§PNL.3): ⇔ `source = withdrawal_delivered` (CHECK `ManualRefund_withdrawal_delivered_chk`). */
  shipmentItemId?: string | null;
  deliveredReason?: ShippedRefundReason | null;
  deliveredNote?: string | null;
  paymentRefundId?: string | null;
  orderId?: string | null;
  components: RefundComponents;
  reissuedFromId?: string | null;
  announcedNotifiedAt?: Date | null;
}

export interface ManualRefundActor {
  id: string;
  role: Role;
}

/** Lo que el CLIENTE ve de las transferencias de un caso (§M4-SHIP.15.13 «Lo que ve el resto», SEC-SHIP-M4). */
export interface CustomerTransferView {
  byTransferCents: number;
  transferStatus: 'pending' | 'paid' | 'cancelled' | null;
}

const MR_INCLUDE = {
  replacementCase: {
    select: {
      id: true,
      source: true,
      refundReason: true,
      originalInventoryItem: { include: { card: { include: { set: true } } } },
    },
  },
  // v1.82 (§PNL.3): la línea del retiro ENTREGADO (`withdrawal_delivered`).
  shipmentItem: {
    select: {
      id: true,
      shipmentRequestId: true,
      inventoryItem: { include: { card: { include: { set: true } } } },
      shipmentRequest: { select: { id: true, deliveredAt: true } },
    },
  },
  order: { select: { id: true, orderNumber: true, status: true } },
  customer: { select: { id: true, name: true, nameSource: true, email: true } },
  reissuedAs: { select: { id: true } },
} satisfies Prisma.ManualRefundInclude;
type MrRow = Prisma.ManualRefundGetPayload<{ include: typeof MR_INCLUDE }>;

@Injectable()
export class ManualRefundService {
  private readonly logger = new Logger(ManualRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: PiiCryptoService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  // ================================================================ creación (C-MREF-1: tres llamadores)

  /**
   * Nace una fila `pending` + bitácora `manual_refund.created` (`entityType='ManualRefund'`, ⛔ sin CLABE ni nombre).
   * Llamadores exactos: el reembolso del caso (`case_excess`), `toManual` (`stripe_failed`), `reissue` y (v1.82)
   * la devolución de un retiro entregado (`withdrawal_delivered`, con su propia acción de bitácora, §PNL.3 paso 8).
   */
  async createRow(
    tx: Tx,
    data: NewManualRefund,
    actor: ManualRefundActor,
    extraAudit: Record<string, unknown> = {},
    auditAction = 'manual_refund.created',
  ): Promise<ManualRefund> {
    if (!Number.isInteger(data.components.amountCents) || data.components.amountCents <= 0) {
      throw new Error(`createRow: amountCents must be a positive integer (${data.idempotencyKey})`);
    }
    const row = await tx.manualRefund.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        idempotencyKey: data.idempotencyKey,
        source: data.source,
        customerUserId: data.customerUserId,
        replacementCaseId: data.replacementCaseId,
        shipmentItemId: data.shipmentItemId ?? null,
        deliveredReason: data.deliveredReason ?? null,
        deliveredNote: data.deliveredNote ?? null,
        paymentRefundId: data.paymentRefundId ?? null,
        orderId: data.orderId ?? null,
        amountCents: data.components.amountCents,
        merchandiseCents: data.components.merchandiseCents,
        merchandiseIvaCents: data.components.merchandiseIvaCents,
        processingFeeCents: data.components.processingFeeCents,
        compensationCents: data.components.compensationCents,
        createdByUserId: actor.id,
        reissuedFromId: data.reissuedFromId ?? null,
        announcedNotifiedAt: data.announcedNotifiedAt ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: auditAction,
        entityType: 'ManualRefund',
        entityId: row.id,
        after: { amountCents: row.amountCents, source: row.source, caseId: row.replacementCaseId, orderId: row.orderId, ...extraAudit },
      },
    });
    return row;
  }

  // ================================================================ lecturas

  private async load(db: Tx | PrismaService, id: string): Promise<MrRow | null> {
    // PROJECTION-EXEMPT: fila interna; `toDtos` proyecta antes de responder.
    return db.manualRefund.findUnique({ where: { id }, include: MR_INCLUDE });
  }

  /** `clabeChangedRecently` (§M4-SHIP.17.3 (2)): UNA constante, un cuerpo. `null` ⇒ registrada antes de M-61 ⇒ false. */
  static clabeChangedRecently(clabeUpdatedAt: Date | null, createdAt: Date, now: Date): boolean {
    if (!clabeUpdatedAt) return false;
    return clabeUpdatedAt.getTime() > createdAt.getTime() || now.getTime() - clabeUpdatedAt.getTime() < CLABE_RECENT_CHANGE_MS;
  }

  /** Proyección en LOTE (sin N+1): `KycProfile` y nombres de operadores por `in`. La CLABE se descifra EN MEMORIA para enmascarar. */
  async toDtos(rows: MrRow[], now = new Date()): Promise<ManualRefundDTO[]> {
    if (rows.length === 0) return [];
    const customerIds = [...new Set(rows.map((r) => r.customerUserId))];
    const kycs = await this.prisma.kycProfile.findMany({
      where: { userId: { in: customerIds } },
      select: { userId: true, legalName: true, clabeEnc: true, clabeHmac: true, clabeUpdatedAt: true },
    });
    const kycByUser = new Map(kycs.map((k) => [k.userId, k]));
    const operatorIds = [...new Set(rows.flatMap((r) => [r.createdByUserId, r.paidByUserId, r.cancelledByUserId]).filter((x): x is string => !!x))];
    const ops = operatorIds.length ? await this.prisma.user.findMany({ where: { id: { in: operatorIds } }, select: { id: true, name: true } }) : [];
    const opName = new Map(ops.map((u) => [u.id, nullIfBlank(u.name)]));
    const by = (id: string | null) => (id ? { userId: id, name: opName.get(id) ?? null } : null);
    return rows.map((r) => {
      const kyc = kycByUser.get(r.customerUserId);
      // Mismo camino que `GET /users/me/kyc` y la ficha 360°: `tryDecryptOptional` ⇒ degrada, ⛔ nunca un 500 ni un reveal.
      const clabe = this.pii.tryDecryptOptional(kyc?.clabeEnc).value;
      const kase = r.replacementCase;
      const line = r.shipmentItem;
      return {
        id: r.id,
        source: r.source,
        status: r.status,
        amountCents: r.amountCents,
        components: {
          merchandiseCents: r.merchandiseCents,
          merchandiseIvaCents: r.merchandiseIvaCents,
          processingFeeCents: r.processingFeeCents,
          compensationCents: r.compensationCents,
        },
        customer: { userId: r.customer.id, fullName: customerDisplayName(r.customer), email: customerEmailOrBlank(r.customer.email, 'ManualRefundDTO.customer', r.customer.id) },
        beneficiaryName: nullIfBlank(kyc?.legalName) ?? customerDisplayName(r.customer),
        clabeOnFile: Boolean(kyc?.clabeEnc),
        clabeMasked: maskClabe(clabe) ?? null,
        clabeUpdatedAt: kyc?.clabeUpdatedAt ? kyc.clabeUpdatedAt.toISOString() : null,
        clabeChangedRecently: ManualRefundService.clabeChangedRecently(kyc?.clabeUpdatedAt ?? null, r.createdAt, now),
        case: kase
          ? {
              id: kase.id,
              source: kase.source,
              card: preparationCardOf(kase.originalInventoryItem),
              folio: kase.originalInventoryItem.folio,
              reason: kase.refundReason ?? '',
            }
          : null,
        withdrawal:
          r.source === 'withdrawal_delivered' && line
            ? {
                shipmentId: line.shipmentRequestId,
                shipmentItemId: line.id,
                card: preparationCardOf(line.inventoryItem),
                folio: line.inventoryItem.folio,
                reason: r.deliveredReason as ShippedRefundReason,
                note: r.deliveredNote ?? '',
                deliveredAt: line.shipmentRequest.deliveredAt ? line.shipmentRequest.deliveredAt.toISOString() : null,
              }
            : null,
        origin: r.order ? { orderId: r.order.id, orderNumber: nullIfBlank(r.order.orderNumber), orderStatus: r.order.status } : null,
        paymentRefundId: r.paymentRefundId,
        createdAt: r.createdAt.toISOString(),
        createdBy: by(r.createdByUserId) as { userId: string; name: string | null },
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        paidBy: by(r.paidByUserId),
        speiReference: r.speiReference,
        paidNote: r.paidNote,
        paidToCurrentClabe: r.status === 'paid' ? this.pii.blindIndexEquals(r.paidClabeHmac, kyc?.clabeHmac) : null,
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        cancelledBy: by(r.cancelledByUserId),
        cancelNote: r.cancelNote,
        reissuedFromId: r.reissuedFromId,
        reissuedAsId: r.reissuedAs?.id ?? null,
      };
    });
  }

  async dtosByIds(ids: string[], now = new Date()): Promise<ManualRefundDTO[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.manualRefund.findMany({ where: { id: { in: ids } }, include: MR_INCLUDE, orderBy: { createdAt: 'asc' } });
    return this.toDtos(rows, now);
  }

  async dtosByCase(caseIds: string[], now = new Date()): Promise<Map<string, ManualRefundDTO[]>> {
    const out = new Map<string, ManualRefundDTO[]>();
    if (caseIds.length === 0) return out;
    const rows = await this.prisma.manualRefund.findMany({ where: { replacementCaseId: { in: caseIds } }, include: MR_INCLUDE, orderBy: { createdAt: 'asc' } });
    const dtos = await this.toDtos(rows, now);
    // (`replacementCaseId ∈ caseIds` ⇒ no nulo en estas filas.)
    rows.forEach((r, i) => out.set(r.replacementCaseId as string, [...(out.get(r.replacementCaseId as string) ?? []), dtos[i]]));
    return out;
  }

  /**
   * Lo que el CLIENTE ve (§M4-SHIP.15.13, SEC-SHIP-M4): la fila VIGENTE de la cadena de re-emisiones (la última por
   * `createdAt`): `pending`/`paid` si hay una viva; `cancelled` si todas están canceladas; `null` sin filas.
   * ⛔ Sin la nota de cancelación, sin CLABE, sin actor.
   */
  async customerTransferViews(db: Tx | PrismaService, caseIds: string[]): Promise<Map<string, CustomerTransferView>> {
    const out = new Map<string, CustomerTransferView>();
    if (caseIds.length === 0) return out;
    const rows = await db.manualRefund.findMany({
      where: { replacementCaseId: { in: caseIds } },
      select: { replacementCaseId: true, status: true, amountCents: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) {
      const caseId = r.replacementCaseId as string; // `∈ caseIds` ⇒ no nulo
      const cur = out.get(caseId);
      // La última por `createdAt` gana; una viva manda sobre las canceladas anteriores.
      if (!cur || cur.transferStatus === 'cancelled' || r.status !== 'cancelled') {
        out.set(caseId, { byTransferCents: r.amountCents, transferStatus: r.status });
      }
    }
    return out;
  }

  /** `GET /admin/manual-refunds` — la cubeta. `pending` por `createdAt` asc; los demás por su sello desc. */
  async list(raw: { status?: string; q?: string; page?: string; pageSize?: string }) {
    const f = parseAdminListFilters({ page: raw.page ?? '1', pageSize: raw.pageSize ?? '25', q: raw.q });
    const status = parseEnumFilter('status', raw.status, STATUS_VALUES) ?? 'pending';
    const where: Prisma.ManualRefundWhereInput = { status };
    if (f.q) {
      const q = f.q;
      const users = await this.prisma.user.findMany({
        where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
        select: { id: true },
      });
      where.OR = [
        { customerUserId: { in: users.map((u) => u.id) } },
        { order: { orderNumber: { contains: q, mode: 'insensitive' } } },
        { replacementCase: { originalInventoryItem: { folio: { contains: q, mode: 'insensitive' } } } },
        // v1.82 (§PNL.3): el folio de la carta de un retiro entregado.
        { shipmentItem: { inventoryItem: { folio: { contains: q, mode: 'insensitive' } } } },
        { speiReference: { contains: q, mode: 'insensitive' } },
        { id: q },
      ];
    }
    const orderBy: Prisma.ManualRefundOrderByWithRelationInput =
      status === 'pending' ? { createdAt: 'asc' } : status === 'paid' ? { paidAt: 'desc' } : { cancelledAt: 'desc' };
    const [rows, total, pending] = await Promise.all([
      this.prisma.manualRefund.findMany({ where, include: MR_INCLUDE, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.manualRefund.count({ where }),
      this.prisma.manualRefund.aggregate({ where: { status: 'pending' }, _sum: { amountCents: true } }),
    ]);
    return { data: await this.toDtos(rows), page: f.page, pageSize: f.pageSize, total, pendingCents: pending._sum.amountCents ?? 0 };
  }

  async get(id: string): Promise<ManualRefundDTO> {
    const row = await this.load(this.prisma, id);
    if (!row) throw BusinessException.notFound('NOT_FOUND', 'Manual refund not found');
    return (await this.toDtos([row]))[0];
  }

  /** `workQueue.manualRefunds` (§M4-SHIP.11): solo súper-admin. */
  async pendingSummary(): Promise<{ pending: number; pendingCents: number; oldestCreatedAt: string | null }> {
    const [agg, oldest] = await Promise.all([
      this.prisma.manualRefund.aggregate({ where: { status: 'pending' }, _count: { _all: true }, _sum: { amountCents: true } }),
      this.prisma.manualRefund.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return { pending: agg._count._all, pendingCents: agg._sum.amountCents ?? 0, oldestCreatedAt: oldest ? oldest.createdAt.toISOString() : null };
  }

  // ================================================================ reveal-clabe (§M4-SHIP.17.3 (3))

  revealTokenOf(manualRefundId: string, clabeHmac: string): string {
    return this.pii.domainHmac(`${MANUAL_REFUND_REVEAL_DOMAIN}${manualRefundId}:`, clabeHmac);
  }

  /**
   * La CLABE en claro para copiarla a la banca — solo `pending`, solo `super_admin`, UNA bitácora por llamada
   * (`manual_refund.reveal_clabe`, ⛔ sin la CLABE en `after`), `Cache-Control: no-store`. Devuelve el `revealToken`
   * que ata la CLABE revelada a `paid`. ⛔ El token no se registra en bitácora ni en logs.
   */
  async revealClabe(id: string, actor: ManualRefundActor, now = new Date()) {
    const row = await this.load(this.prisma, id);
    if (!row) throw BusinessException.notFound('NOT_FOUND', 'Manual refund not found');
    if (row.status !== 'pending') {
      throw BusinessException.conflict('MANUAL_REFUND_NOT_PENDING', `Manual refund is ${row.status}`, { status: row.status });
    }
    const kyc = await this.prisma.kycProfile.findUnique({
      where: { userId: row.customerUserId },
      select: { legalName: true, clabeEnc: true, clabeHmac: true, clabeUpdatedAt: true },
    });
    const clabe = this.pii.decryptOptional(kyc?.clabeEnc);
    if (!clabe || !kyc?.clabeHmac) {
      throw BusinessException.validation('CLABE_NOT_ON_FILE', 'The customer has no CLABE on file');
    }
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'manual_refund.reveal_clabe',
        entityType: 'ManualRefund',
        entityId: row.id,
        after: { customerUserId: row.customerUserId, amountCents: row.amountCents },
      },
    });
    return {
      clabe,
      beneficiaryName: nullIfBlank(kyc.legalName) ?? customerDisplayName(row.customer),
      clabeUpdatedAt: kyc.clabeUpdatedAt ? kyc.clabeUpdatedAt.toISOString() : null,
      clabeChangedRecently: ManualRefundService.clabeChangedRecently(kyc.clabeUpdatedAt, row.createdAt, now),
      revealToken: this.revealTokenOf(row.id, kyc.clabeHmac),
    };
  }

  // ================================================================ paid (§M4-SHIP.17.3 (4))

  async paid(
    id: string,
    body: { revealToken: string; speiReference?: string | null; note?: string | null; confirmRecentClabeChange?: boolean; confirmOriginNotSettled?: boolean },
    actor: ManualRefundActor,
    now = new Date(),
  ): Promise<ManualRefundDTO & { outcome: 'paid' | 'already_paid' }> {
    const head = await this.prisma.manualRefund.findUnique({ where: { id }, select: { id: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Manual refund not found');
    const speiReference = nullIfBlank(body.speiReference ?? null);
    const outcome = await this.prisma.$transaction(async (tx) => {
      // 2. la fila, FOR UPDATE.
      await tx.$queryRaw`SELECT id FROM "ManualRefund" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.manualRefund.findUniqueOrThrow({ where: { id } });
      // 3. ya pagada: misma referencia (o sin referencia) ⇒ 200 already_paid; otra ⇒ 409. Cancelada ⇒ 409.
      if (row.status === 'paid') {
        if (speiReference === null || speiReference === row.speiReference) return 'already_paid' as const;
        throw BusinessException.conflict('MANUAL_REFUND_NOT_PENDING', 'Manual refund already paid with another reference', { status: row.status });
      }
      if (row.status !== 'pending') {
        throw BusinessException.conflict('MANUAL_REFUND_NOT_PENDING', `Manual refund is ${row.status}`, { status: row.status });
      }
      // 4. KycProfile FOR UPDATE (serializa con `setClabe`); sin CLABE ⇒ 422.
      await tx.$queryRaw`SELECT id FROM "KycProfile" WHERE "userId" = ${row.customerUserId} FOR UPDATE`;
      const kyc = await tx.kycProfile.findUnique({
        where: { userId: row.customerUserId },
        select: { clabeEnc: true, clabeHmac: true, clabeUpdatedAt: true },
      });
      if (!kyc?.clabeEnc || !kyc.clabeHmac) {
        throw BusinessException.validation('CLABE_NOT_ON_FILE', 'The customer has no CLABE on file');
      }
      // 5. el token, contra el `clabeHmac` VIGENTE (tiempo constante).
      const expected = this.revealTokenOf(row.id, kyc.clabeHmac);
      if (!this.pii.constantTimeEquals(expected, body.revealToken)) {
        throw BusinessException.conflict('CLABE_CHANGED_SINCE_REVEAL', 'The CLABE changed since it was revealed', {
          clabeUpdatedAt: kyc.clabeUpdatedAt ? kyc.clabeUpdatedAt.toISOString() : null,
        });
      }
      // 6. orden de origen FOR SHARE.
      let originStatus: OrderStatus | null = null;
      if (row.orderId) {
        const o = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM "Order" WHERE id = ${row.orderId} FOR SHARE`;
        originStatus = o[0]?.status ?? null;
      }
      // 7. confirmaciones exigidas.
      const recent = ManualRefundService.clabeChangedRecently(kyc.clabeUpdatedAt, row.createdAt, now);
      const originNotSettled = originStatus !== null && originStatus !== 'settled';
      const required: string[] = [];
      if (recent && body.confirmRecentClabeChange !== true) required.push('recent_clabe_change');
      if (originNotSettled && body.confirmOriginNotSettled !== true) required.push('origin_not_settled');
      if (required.length > 0) {
        throw BusinessException.validation('MANUAL_REFUND_CONFIRMATION_REQUIRED', 'Reinforced confirmation required', {
          required,
          ...(recent ? { clabeUpdatedAt: kyc.clabeUpdatedAt ? kyc.clabeUpdatedAt.toISOString() : null } : {}),
          ...(originNotSettled ? { originStatus } : {}),
        });
      }
      // 8. CAS.
      const res = await tx.manualRefund.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'paid',
          paidAt: now,
          paidByUserId: actor.id,
          speiReference,
          paidNote: nullIfBlank(body.note ?? null),
          paidClabeHmac: kyc.clabeHmac,
        },
      });
      if (res.count !== 1) throw BusinessException.conflict('CONFLICT', 'Manual refund changed concurrently');
      // 9. bitácora.
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'manual_refund.paid',
          entityType: 'ManualRefund',
          entityId: id,
          after: {
            amountCents: row.amountCents,
            speiReference,
            originOrderStatus: originStatus,
            clabeUpdatedAt: kyc.clabeUpdatedAt ? kyc.clabeUpdatedAt.toISOString() : null,
            confirmedRecentClabeChange: body.confirmRecentClabeChange === true,
            confirmedOriginNotSettled: body.confirmOriginNotSettled === true,
          },
        },
      });
      return 'paid' as const;
    });
    if (outcome === 'paid') await this.notifyPaid(id);
    // QA BLOQ-1 sobre `c20451f`: la respuesta ES el `ManualRefundDTO` (§M4-SHIP.17.3 paso 4, como `reissue`/`to-manual`);
    // `outcome` viaja como campo ADITIVO (`paid` | `already_paid`), ⛔ nunca envolviendo el DTO.
    return { ...(await this.get(id)), outcome };
  }

  // ================================================================ cancel

  async cancel(id: string, body: { note: string }, actor: ManualRefundActor, now = new Date()): Promise<ManualRefundDTO & { outcome: 'cancelled' | 'already_cancelled' }> {
    const head = await this.prisma.manualRefund.findUnique({ where: { id }, select: { id: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Manual refund not found');
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ManualRefund" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.manualRefund.findUniqueOrThrow({ where: { id } });
      if (row.status === 'cancelled') return 'already_cancelled' as const;
      if (row.status !== 'pending') {
        throw BusinessException.conflict('MANUAL_REFUND_NOT_PENDING', `Manual refund is ${row.status}`, { status: row.status });
      }
      const res = await tx.manualRefund.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'cancelled', cancelledAt: now, cancelledByUserId: actor.id, cancelNote: body.note.trim() },
      });
      if (res.count !== 1) throw BusinessException.conflict('CONFLICT', 'Manual refund changed concurrently');
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'manual_refund.cancelled',
          entityType: 'ManualRefund',
          entityId: id,
          after: { amountCents: row.amountCents, note: body.note.trim(), caseId: row.replacementCaseId },
        },
      });
      return 'cancelled' as const;
    });
    // ⛔ Sin aviso (decisión del dueño con nota); ⛔ no reabre el caso. La respuesta ES el DTO (+ `outcome` aditivo, QA BLOQ-1).
    return { ...(await this.get(id)), outcome };
  }

  // ================================================================ reissue (§M4-SHIP.17.8)

  async reissue(id: string, body: { note: string }, actor: ManualRefundActor): Promise<ManualRefundDTO> {
    const head = await this.prisma.manualRefund.findUnique({ where: { id }, select: { id: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Manual refund not found');
    const newId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ManualRefund" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.manualRefund.findUniqueOrThrow({ where: { id }, include: { reissuedAs: { select: { id: true } } } });
      if (row.status !== 'cancelled') {
        throw BusinessException.conflict('MANUAL_REFUND_NOT_CANCELLED', `Manual refund is ${row.status}`, { status: row.status });
      }
      if (row.reissuedAs) return row.reissuedAs.id;
      // La «viva» que impide re-emitir: la del MISMO caso y canal; v1.82 (§PNL.3) — sin caso, la de la MISMA línea de
      // retiro (⛔ un `replacementCaseId: null` en el `WHERE` encontraría la viva de OTRO retiro).
      const alive = await tx.manualRefund.findFirst({
        where:
          row.source === 'withdrawal_delivered'
            ? { shipmentItemId: row.shipmentItemId as string, status: { not: 'cancelled' } }
            : { replacementCaseId: row.replacementCaseId, source: row.source, status: { not: 'cancelled' } },
        select: { id: true },
      });
      if (alive) {
        throw BusinessException.conflict('MANUAL_REFUND_NOT_CANCELLED', 'Another live manual refund exists for this case', {
          status: 'cancelled',
          activeManualRefundId: alive.id,
        });
      }
      let created: ManualRefund;
      try {
        created = await this.createRow(
          tx,
          {
            source: row.source,
            idempotencyKey: `reissue:${row.id}`,
            customerUserId: row.customerUserId,
            replacementCaseId: row.replacementCaseId,
            shipmentItemId: row.shipmentItemId,
            deliveredReason: row.deliveredReason,
            deliveredNote: row.deliveredNote,
            paymentRefundId: row.paymentRefundId,
            orderId: row.orderId,
            components: {
              amountCents: row.amountCents,
              merchandiseCents: row.merchandiseCents,
              merchandiseIvaCents: row.merchandiseIvaCents,
              shippingCents: 0,
              shippingIvaCents: 0,
              processingFeeCents: row.processingFeeCents,
              compensationCents: row.compensationCents,
            },
            reissuedFromId: row.id,
            announcedNotifiedAt: row.announcedNotifiedAt,
          },
          actor,
          { reissuedFromId: row.id },
        );
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw BusinessException.conflict('CONFLICT', 'A reissue already exists for this manual refund');
        }
        throw e;
      }
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'manual_refund.reissued',
          entityType: 'ManualRefund',
          entityId: row.id,
          after: { fromId: row.id, newId: created.id, amountCents: created.amountCents, note: body.note.trim() },
        },
      });
      return created.id;
    });
    // ⛔ Sin segundo `AV-14` (el sello viaja con la fila nueva).
    return this.get(newId);
  }

  // ================================================================ to-manual (§M4-SHIP.17.4)

  async toManual(refundId: string, actor: ManualRefundActor): Promise<ManualRefundDTO> {
    const head = await this.prisma.paymentRefund.findUnique({ where: { id: refundId }, select: { id: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Refund not found');
    const { id, created } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PaymentRefund" WHERE id = ${refundId} FOR UPDATE`;
      const row = await tx.paymentRefund.findUniqueOrThrow({
        where: { id: refundId },
        include: { replacementCase: { select: { id: true, customerUserId: true } } },
      });
      if (row.kind !== 'case_refund') {
        throw BusinessException.conflict('REFUND_NOT_CONVERTIBLE', 'Only case refunds can be moved to SPEI', { kind: row.kind });
      }
      if (row.status !== 'failed') {
        throw BusinessException.conflict('REFUND_NOT_CONVERTIBLE', 'Only failed refunds can be moved to SPEI', { status: row.status });
      }
      // 2. idempotencia ANTES de mirar la orden: repetir no crea dinero.
      const existing = await tx.manualRefund.findUnique({ where: { idempotencyKey: `refund-spei:${refundId}` }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };
      // 3. orden de origen FOR UPDATE.
      let originStatus: OrderStatus = 'settled';
      if (row.orderId) {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${row.orderId} FOR UPDATE`;
        const o = await tx.order.findUniqueOrThrow({ where: { id: row.orderId }, select: { status: true } });
        originStatus = o.status;
        if (originStatus !== 'settled') {
          throw BusinessException.conflict('CASE_ORIGIN_NOT_SETTLED', 'The origin order is no longer settled', { originStatus });
        }
      }
      // 4. Stripe dijo «en disputa» aunque la orden aún no lo sepa.
      if (row.failureCode && REFUND_FAILURE_DISPUTE_CODES.includes(row.failureCode)) {
        throw BusinessException.conflict('CASE_ORIGIN_NOT_SETTLED', 'The charge is disputed', { originStatus: 'settled', reason: 'charge_disputed' });
      }
      const mr = await this.createRow(
        tx,
        {
          source: 'stripe_failed',
          idempotencyKey: `refund-spei:${refundId}`,
          customerUserId: row.replacementCase!.customerUserId,
          replacementCaseId: row.replacementCase!.id,
          paymentRefundId: row.id,
          orderId: row.orderId,
          components: {
            amountCents: row.amountCents,
            merchandiseCents: row.merchandiseCents,
            merchandiseIvaCents: row.merchandiseIvaCents,
            shippingCents: 0,
            shippingIvaCents: 0,
            processingFeeCents: row.processingFeeCents,
            compensationCents: row.compensationCents,
          },
        },
        actor,
        { originStatus, paymentRefundId: row.id },
      );
      return { id: mr.id, created: true };
    });
    if (created) await this.notifyAnnounced([id]);
    return this.get(id);
  }

  // ================================================================ avisos (AV-14 / AV-15)

  /** `AV-14` — post-commit, best-effort; sello `announcedNotifiedAt` reclamado. ⛔ Nunca la CLABE entera. */
  async notifyAnnounced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      if (!this.mail) return;
      const now = new Date();
      const claimed = await this.prisma.manualRefund.updateMany({ where: { id: { in: ids }, announcedNotifiedAt: null }, data: { announcedNotifiedAt: now } });
      if (claimed.count === 0) return;
      const rows = await this.prisma.manualRefund.findMany({
        where: { id: { in: ids }, announcedNotifiedAt: now },
        include: {
          paymentRefund: { select: { amountCents: true, status: true } },
          replacementCase: { select: { refund: { select: { amountCents: true, status: true } } } },
          // v1.82 (§PNL.3): la variante `withdrawal_delivered` nombra la carta y el retiro.
          shipmentItem: { select: { shipmentRequestId: true, inventoryItem: { select: { card: { select: { name: true } } } } } },
        },
      });
      for (const r of rows) {
        const user = await this.prisma.user.findUnique({ where: { id: r.customerUserId }, select: { email: true, locale: true, anonymizedAt: true } });
        if (!user || user.anonymizedAt) continue;
        // v1.80.9 (D-STF-2, §M6-U.8 (a) E-4): cuenta sin correo ⇒ se omite con aviso, sin error ni reintento.
        if (!user.email) {
          this.logger.warn(`AV-14 omitido para ${r.id}: la cuenta no tiene correo`);
          continue;
        }
        const kyc = await this.prisma.kycProfile.findUnique({ where: { userId: r.customerUserId }, select: { clabeEnc: true } });
        const clabe = this.pii.tryDecryptOptional(kyc?.clabeEnc).value;
        // «y MX$A regresan a tu tarjeta»: la fila Stripe viva del mismo caso (⛔ no la fallida que esta sustituye).
        const stripeRow = r.source === 'case_excess' ? (r.replacementCase?.refund ?? null) : null;
        const cardCents = stripeRow && stripeRow.status !== 'failed' ? stripeRow.amountCents : 0;
        await this.mail.send({
          ...manualRefundAnnouncedTemplate(
            {
              transferCents: r.amountCents,
              cardCents,
              clabeMasked: maskClabe(clabe) ?? null,
              ...(r.source === 'withdrawal_delivered' && r.shipmentItem
                ? { withdrawal: { reference: r.shipmentItem.shipmentRequestId, cardName: r.shipmentItem.inventoryItem.card.name, reason: r.deliveredReason } }
                : {}),
            },
            user.locale,
          ),
          to: user.email,
        });
      }
    } catch (e) {
      this.logger.error(`AV-14 falló: ${(e as Error).message}`);
    }
  }

  /** `AV-15` — post-commit, best-effort; sello `paidNotifiedAt`. */
  async notifyPaid(id: string): Promise<void> {
    try {
      if (!this.mail) return;
      const now = new Date();
      const claimed = await this.prisma.manualRefund.updateMany({ where: { id, status: 'paid', paidNotifiedAt: null }, data: { paidNotifiedAt: now } });
      if (claimed.count === 0) return;
      const r = await this.prisma.manualRefund.findUniqueOrThrow({ where: { id } });
      const user = await this.prisma.user.findUnique({ where: { id: r.customerUserId }, select: { email: true, locale: true, anonymizedAt: true } });
      if (!user || user.anonymizedAt) return;
      // v1.80.9 (D-STF-2): sin correo ⇒ se omite con aviso.
      if (!user.email) {
        this.logger.warn(`AV-15 omitido para ${id}: la cuenta no tiene correo`);
        return;
      }
      await this.mail.send({ ...manualRefundPaidTemplate({ transferCents: r.amountCents, speiReference: r.speiReference }, user.locale), to: user.email });
    } catch (e) {
      this.logger.error(`AV-15 falló para ${id}: ${(e as Error).message}`);
    }
  }
}

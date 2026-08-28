import { Injectable } from '@nestjs/common';
import { DisputeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { StripeService } from '../payments/stripe.service';
import { DISPUTE_EVIDENCE_CONTACT } from './disputes.constants';

/**
 * v2.1.9 (S49-R4) — **`Dispute` se proyecta; nunca sale la fila cruda.**
 *
 * Cuatro rutas devolvían la entidad: `GET /disputes`, `GET /disputes/:id` (ambas del **cliente**),
 * `GET /admin/disputes` y `POST /admin/disputes/:id/resolve`. Hoy `Dispute` no guarda secretos, pero
 * sí dos campos que son **de back-office, no del cliente**: `resolvedBy` (uuid del súper-admin que
 * resolvió) y `repurchaseOrderId`. Y sobre todo: mientras la respuesta SEA la entidad, la próxima
 * columna del schema se publica sola — que es exactamente la clase que este pase viene a cerrar.
 *
 * Dos proyecciones, porque son dos audiencias:
 *  - `toDisputeDTO` (cliente): lo que el contrato §7 declara — estado, tipo, descripción, plazo.
 *  - `toAdminDisputeRow` (back-office): añade `resolvedBy`/`repurchaseOrderId`/`userId`.
 */
type DisputeRow = {
  id: string;
  userId: string;
  inventoryItemId: string;
  orderItemId: string | null;
  type: string;
  status: DisputeStatus;
  description: string;
  resolution: string | null;
  repurchaseOrderId: string | null;
  deadlineAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
};

function toDisputeDTO(d: DisputeRow) {
  return {
    id: d.id,
    inventoryItemId: d.inventoryItemId,
    type: d.type,
    status: d.status,
    description: d.description,
    // La resolución (texto que el admin escribió) SÍ es del cliente: es el desenlace de SU disputa.
    resolution: d.resolution,
    deadlineAt: d.deadlineAt,
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt,
    evidenceContact: DISPUTE_EVIDENCE_CONTACT,
    // FUERA a propósito: `resolvedBy` (identidad del staff) y `repurchaseOrderId` (referencia
    // interna de la compensación). `userId` tampoco: el cliente es el dueño de la sesión, no
    // necesita que se lo devolvamos.
  };
}

function toAdminDisputeRow(d: DisputeRow) {
  return {
    ...toDisputeDTO(d),
    userId: d.userId,
    orderItemId: d.orderItemId,
    repurchaseOrderId: d.repurchaseOrderId,
    resolvedBy: d.resolvedBy,
  };
}

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Crea disputa de condición (raw o sellado). Ventana = 7 días desde entrega. API_CONTRACT §7.
   * v1.2: la evidencia se envía POR CORREO a soporte (evidenceContact); no hay subida de fotos.
   * El graded no aplica (el slab es la garantía) → NOT_RAW.
   */
  async create(userId: string, inventoryItemId: string, description: string) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } });
    if (!item || item.ownerUserId !== userId) throw BusinessException.forbidden('FORBIDDEN');
    // v1.2: la disputa de condición aplica a raw (carta dañada/equivocada) y a SELLADO
    // (caja dañada/equivocada). La evidencia va por correo a soporte (ARCHITECTURE §3.6).
    // El graded no aplica (el slab es la garantía) → NOT_RAW.
    if (item.productType === 'graded') {
      throw BusinessException.validation('NOT_RAW', 'Disputes apply only to raw/sealed items');
    }
    const disputeType = item.productType === 'sealed' ? 'condition_sealed' : 'condition_raw';
    // Ventana de 7 días desde entrega (busca el envío entregado del item).
    const shipmentItem = await this.prisma.shipmentItem.findFirst({
      where: { inventoryItemId, shipmentRequest: { status: 'entregado' } },
      include: { shipmentRequest: true },
      orderBy: { shipmentRequest: { deliveredAt: 'desc' } },
    });
    const deliveredAt = shipmentItem?.shipmentRequest.deliveredAt;
    const now = new Date();
    if (deliveredAt) {
      const deadline = new Date(deliveredAt.getTime() + 7 * 24 * 3600 * 1000);
      if (now > deadline) {
        throw BusinessException.validation('DISPUTE_WINDOW_CLOSED', 'Dispute window (7d) closed');
      }
    }
    const deadlineAt = deliveredAt
      ? new Date(deliveredAt.getTime() + 7 * 24 * 3600 * 1000)
      : new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    const dispute = await this.prisma.dispute.create({
      data: {
        userId,
        inventoryItemId,
        type: disputeType,
        status: 'abierta',
        description,
        deadlineAt,
      },
    });
    // API_CONTRACT §7: la respuesta 201 incluye `type` (condition_raw|condition_sealed),
    // derivado server-side del productType del item, y `evidenceContact` (correo de soporte
    // donde el cliente envía la evidencia; v1.2, ya no hay subida de foto).
    return {
      disputeId: dispute.id,
      status: dispute.status,
      type: dispute.type,
      deadlineAt: dispute.deadlineAt,
      evidenceContact: DISPUTE_EVIDENCE_CONTACT,
    };
  }

  async listMine(userId: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    // S49-R4: proyectado (antes devolvía las filas crudas).
    return { data: rows.map(toDisputeDTO) };
  }

  async getMine(userId: string, id: string) {
    const d = await this.prisma.dispute.findUnique({ where: { id } });
    if (!d || d.userId !== userId) throw BusinessException.notFound();
    return toDisputeDTO(d); // S49-R4
  }

  // ---------------- Admin M8 ----------------

  async adminList(
    status: string | undefined,
    page: number,
    pageSize: number,
    userId?: string,
  ) {
    const where: Prisma.DisputeWhereInput = {};
    if (status) where.status = status as never;
    // v1.7-admin-users: filtro opcional por Dispute.userId (simetría con /admin/orders).
    if (userId) where.userId = userId;
    const [rows, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    // S49-R4: proyectado (antes devolvía las filas crudas).
    return { data: rows.map(toAdminDisputeRow), page, pageSize, total };
  }

  /**
   * Detalle admin de disputa. API_CONTRACT §M8.
   * v1.2: SIN comparador de fotos — la evidencia llega por correo a soporte (evidenceContact).
   * Para gradeadas el detalle expone gradingCompany + gradeValue + certNumber (verificable en
   * la graduadora); la imagen del item es la de catálogo remota.
   */
  async adminGet(id: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: { inventoryItem: { include: { card: true } } },
    });
    if (!dispute) throw BusinessException.notFound();
    return {
      id: dispute.id,
      status: dispute.status,
      description: dispute.description,
      type: dispute.type,
      deadlineAt: dispute.deadlineAt,
      evidenceContact: DISPUTE_EVIDENCE_CONTACT,
      item: dispute.inventoryItem,
      order: null,
    };
  }

  /**
   * Resuelve la disputa. `reject` → rechazada.
   *
   * `repurchase` = money-out (solo `super_admin`, autorizado y AUDITADO en el controller).
   *
   * POLÍTICA DEL HUMANO (VENTAS FINALES): la recompra es una COMPENSACIÓN al precio pagado;
   * el **cliente CONSERVA la carta** y la carta **NO regresa al inventario**. Por eso NO se
   * revierte el `InventoryItem` a plataforma (a diferencia del contracargo, donde sí la
   * recuperamos si sigue en bóveda). El importe de la recompra queda registrado en la
   * resolución para conciliación (M7). El desembolso (SPEI/refund) es money-out del
   * super_admin, ya autorizado.
   *
   * ALINEADO CON EL CONTRATO: API_CONTRACT §M8 ya recoge esta política (VENTAS FINALES: "el
   * cliente conserva la carta y NO regresa al inventario"). No hay discrepancia pendiente ni
   * corrección de contrato solicitada; este comportamiento implementa el contrato tal cual.
   */
  async resolve(id: string, resolution: 'repurchase' | 'reject', note: string, actorUserId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw BusinessException.notFound();
    if (resolution === 'reject') {
      // S49-R4: proyectado.
      return toAdminDisputeRow(
        await this.prisma.dispute.update({
          where: { id },
          data: { status: 'rechazada', resolution: note, resolvedAt: new Date(), resolvedBy: actorUserId },
        }),
      );
    }
    // repurchase: precio pagado = unitPrice del OrderItem del item. El cliente conserva la
    // carta; NO se toca el InventoryItem ni se crea InventoryMovement de reingreso.
    const orderItem = await this.prisma.orderItem.findFirst({
      where: { inventoryItemId: dispute.inventoryItemId },
      orderBy: { id: 'desc' },
    });
    // S49-R4: proyectado.
    return toAdminDisputeRow(
      await this.prisma.dispute.update({
        where: { id },
        data: {
          status: 'resuelta_recompra',
          resolution: `${note} (repurchase ${orderItem?.unitPriceCents ?? 0} cents; customer keeps card, not re-added to inventory)`,
          resolvedAt: new Date(),
          resolvedBy: actorUserId,
        },
      }),
    );
  }
}

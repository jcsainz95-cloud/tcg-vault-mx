import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { StripeService } from '../payments/stripe.service';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * SEC-A5: las fotos de disputa e INGRESO (evidencia canónica) pueden contener PII /
   * identificar al cliente; NO se sirven por URL pública del bucket. Se genera una URL
   * prefirmada de LECTURA de vida corta (bucket privado, garantizado por devops).
   */
  private photoUrl(key: string): Promise<string> {
    return this.uploads.presignGet(key);
  }

  /**
   * Crea disputa de condición raw. Ventana = 7 días desde entrega. API_CONTRACT §7.
   * Solo raw. Las fotos de ingreso son evidencia canónica.
   */
  async create(userId: string, inventoryItemId: string, description: string, claimKeys: string[]) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } });
    if (!item || item.ownerUserId !== userId) throw BusinessException.forbidden('FORBIDDEN');
    if (item.productType !== 'raw') {
      throw BusinessException.validation('NOT_RAW', 'Disputes apply only to raw items');
    }
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

    const ingressPhotoKeys = [item.frontPhotoKey, item.backPhotoKey].filter(Boolean) as string[];
    const dispute = await this.prisma.dispute.create({
      data: {
        userId,
        inventoryItemId,
        type: 'condition_raw',
        status: 'abierta',
        ingressPhotoKeys,
        claimPhotoKeys: claimKeys,
        description,
        deadlineAt,
      },
    });
    return { disputeId: dispute.id, status: dispute.status, deadlineAt: dispute.deadlineAt };
  }

  async listMine(userId: string) {
    const data = await this.prisma.dispute.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  }

  async getMine(userId: string, id: string) {
    const d = await this.prisma.dispute.findUnique({ where: { id } });
    if (!d || d.userId !== userId) throw BusinessException.notFound();
    return d;
  }

  // ---------------- Admin M8 ----------------

  async adminList(status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.DisputeWhereInput = {};
    if (status) where.status = status as never;
    const [data, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { data, page, pageSize, total };
  }

  /** Comparador de fotos: ingreso vs reclamo. API_CONTRACT §M8. */
  async adminGet(id: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: { inventoryItem: { include: { card: true } } },
    });
    if (!dispute) throw BusinessException.notFound();
    const ingressPhotoUrls = await Promise.all(
      ((dispute.ingressPhotoKeys as string[] | null) ?? []).map((k) => this.photoUrl(k)),
    );
    const claimPhotoUrls = await Promise.all(
      ((dispute.claimPhotoKeys as string[] | null) ?? []).map((k) => this.photoUrl(k)),
    );
    return {
      id: dispute.id,
      status: dispute.status,
      description: dispute.description,
      ingressPhotoUrls,
      claimPhotoUrls,
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
   * NOTA DE DISCREPANCIA CON EL CONTRATO (§M8 dice "item revierte a inventario"): la política
   * del humano manda sobre el contrato (CLAUDE.md › regla de conflicto). Se solicita al
   * arquitecto corregir §M8 (ver docs/BACKEND_NOTES.md). No se edita el contrato aquí.
   */
  async resolve(id: string, resolution: 'repurchase' | 'reject', note: string, actorUserId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw BusinessException.notFound();
    if (resolution === 'reject') {
      return this.prisma.dispute.update({
        where: { id },
        data: { status: 'rechazada', resolution: note, resolvedAt: new Date(), resolvedBy: actorUserId },
      });
    }
    // repurchase: precio pagado = unitPrice del OrderItem del item. El cliente conserva la
    // carta; NO se toca el InventoryItem ni se crea InventoryMovement de reingreso.
    const orderItem = await this.prisma.orderItem.findFirst({
      where: { inventoryItemId: dispute.inventoryItemId },
      orderBy: { id: 'desc' },
    });
    return this.prisma.dispute.update({
      where: { id },
      data: {
        status: 'resuelta_recompra',
        resolution: `${note} (repurchase ${orderItem?.unitPriceCents ?? 0} cents; customer keeps card, not re-added to inventory)`,
        resolvedAt: new Date(),
        resolvedBy: actorUserId,
      },
    });
  }
}

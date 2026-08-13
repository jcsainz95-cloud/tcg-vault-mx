import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';
import { toCardDTO } from '../catalog/catalog.service';

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Mi bóveda. El valor de portafolio se calcula contra el VALOR DE REFERENCIA
   * (no el precio de venta). Las cartas con precio pendiente se EXCLUYEN del total
   * y se reportan en pendingPriceCount (no rompen el cálculo). API_CONTRACT §3.
   */
  async holdings(userId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'customer', ownerUserId: userId },
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    });
    let totalValueMxnCents = 0;
    let pendingPriceCount = 0;
    const data = [];
    for (const item of items) {
      const gradeKey = this.pricing.gradeKeyFor(item);
      const referenceValue = await this.pricing.getReference(item.cardId, item.productType, gradeKey);
      if (referenceValue.status === 'priced' && referenceValue.referenceMxnCents != null) {
        totalValueMxnCents += referenceValue.referenceMxnCents;
      } else {
        pendingPriceCount += 1;
      }
      data.push({
        inventoryItemId: item.id,
        folio: item.folio,
        card: toCardDTO(item.card),
        productType: item.productType,
        rawCondition: item.rawCondition ?? undefined,
        gradingCompany: item.gradingCompany ?? undefined,
        gradeValue: item.gradeValue ?? undefined,
        ownershipStatus: item.ownershipStatus,
        status: item.status,
        referenceValue,
      });
    }
    return {
      data,
      portfolio: { totalValueMxnCents, pendingPriceCount, currency: 'MXN' as const },
    };
  }

  async holdingDetail(userId: string, inventoryItemId: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: {
        card: { include: { set: true } },
        movements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) throw BusinessException.notFound();
    if (item.ownerUserId !== userId) throw BusinessException.forbidden('FORBIDDEN');
    const gradeKey = this.pricing.gradeKeyFor(item);
    const referenceValue = await this.pricing.getReference(item.cardId, item.productType, gradeKey);
    return {
      inventoryItemId: item.id,
      folio: item.folio,
      card: toCardDTO(item.card),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      gradingCompany: item.gradingCompany ?? undefined,
      gradeValue: item.gradeValue ?? undefined,
      ownershipStatus: item.ownershipStatus,
      status: item.status,
      referenceValue,
      frontPhotoKey: item.frontPhotoKey,
      backPhotoKey: item.backPhotoKey,
      movements: item.movements,
    };
  }
}

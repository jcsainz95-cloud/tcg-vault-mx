import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { toCardDTO } from '../catalog/catalog.service';

/** before/after del mapeo para la auditoría (`pricing.sealed_mapping.update`). */
export interface SealedMappingState {
  tcgplayerProductId: number | null;
  tcgplayerGroupId: number | null;
}

export interface SealedMappingUpdateResult {
  inventoryItemId: string;
  tcgplayerProductId: number | null;
  tcgplayerGroupId: number | null;
  siblingsUpdated: number;
  /** Estado previo (para el AuditLog del controller; no va en el response del contrato). */
  before: SealedMappingState;
}

/**
 * SealedMappingService — curación MANUAL del mapeo item sellado ↔ producto TCGplayer
 * (v1.19-sealed-tcgcsv, ARCHITECTURE §4.19c / API_CONTRACT §M2).
 *
 * - La cola de pendientes es una consulta DERIVADA (`sealed AND tcgplayerProductId IS NULL`):
 *   sin tabla/estado nuevo, no puede desincronizarse.
 * - `updateMapping` NO valida contra TCGCSV (la curación debe funcionar sin red al remoto y
 *   aunque el dial esté `off`): un productId erróneo simplemente no matchea filas en el
 *   siguiente ingest (referencia null/stale — inocuo, informativo).
 * - Sin fuzzy-matching automático (v1.19): la curación es humana.
 */
@Injectable()
export class SealedMappingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cola de curación: items `sealed` SIN mapeo, lo más viejo primero. API_CONTRACT §M2. */
  async listUnmapped(page: number, pageSize: number) {
    const where = { productType: 'sealed' as const, tcgplayerProductId: null };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { card: { include: { set: true } } },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    const data = rows.map((item) => ({
      inventoryItemId: item.id,
      folio: item.folio,
      card: toCardDTO(item.card),
      ...(item.sealedSubtype ? { sealedSubtype: item.sealedSubtype } : {}),
      ...(item.listPriceCents != null ? { listPriceCents: item.listPriceCents } : {}),
      createdAt: item.createdAt,
    }));
    return { data, page, pageSize, total };
  }

  /**
   * Asigna, actualiza o quita el mapeo de UN item (API_CONTRACT §M2):
   *  - `tcgplayerProductId: null` → desmapea (limpia también `tcgplayerGroupId`).
   *  - con valor → `tcgplayerGroupId` OBLIGATORIO (el fetch de precios es por grupo) y ambos
   *    enteros positivos.
   *  - `applyToSiblings` copia el mapeo a los demás sealed SIN mapeo con el mismo
   *    `(cardId, sealedSubtype)` (las otras copias físicas del mismo producto). NUNCA pisa
   *    mapeos existentes, y con desmapeo (null) no toca a nadie más.
   */
  async updateMapping(
    itemId: string,
    input: {
      tcgplayerProductId: number | null;
      tcgplayerGroupId?: number;
      applyToSiblings?: boolean;
    },
  ): Promise<SealedMappingUpdateResult> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw BusinessException.notFound('NOT_FOUND', 'Inventory item not found');
    if (item.productType !== 'sealed') {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'TCGCSV mapping applies only to sealed items',
        { productType: item.productType },
      );
    }

    const productId = input.tcgplayerProductId;
    let groupId: number | null = null;
    if (productId !== null) {
      if (!Number.isInteger(productId) || productId <= 0) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'tcgplayerProductId must be a positive integer or null',
        );
      }
      if (input.tcgplayerGroupId == null) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'tcgplayerGroupId is required when tcgplayerProductId is set (prices are fetched per group)',
        );
      }
      if (!Number.isInteger(input.tcgplayerGroupId) || input.tcgplayerGroupId <= 0) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'tcgplayerGroupId must be a positive integer',
        );
      }
      groupId = input.tcgplayerGroupId;
    }

    const before: SealedMappingState = {
      tcgplayerProductId: item.tcgplayerProductId,
      tcgplayerGroupId: item.tcgplayerGroupId,
    };

    // Los dos campos se fijan JUNTOS (invariante M-23): ambos null o ambos poblados.
    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { tcgplayerProductId: productId, tcgplayerGroupId: groupId },
    });

    let siblingsUpdated = 0;
    if (input.applyToSiblings && productId !== null) {
      const res = await this.prisma.inventoryItem.updateMany({
        where: {
          id: { not: itemId },
          productType: 'sealed',
          cardId: item.cardId,
          sealedSubtype: item.sealedSubtype, // null matchea null (mismo producto sin subtipo)
          tcgplayerProductId: null, // nunca pisa mapeos existentes
        },
        data: { tcgplayerProductId: productId, tcgplayerGroupId: groupId },
      });
      siblingsUpdated = res.count;
    }

    return {
      inventoryItemId: itemId,
      tcgplayerProductId: productId,
      tcgplayerGroupId: groupId,
      siblingsUpdated,
      before,
    };
  }
}

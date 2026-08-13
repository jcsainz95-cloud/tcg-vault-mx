import { Injectable } from '@nestjs/common';
import { InventoryStatus, MovementReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { computeAportacionCostCents } from '../../common/money';
import {
  CreateItemDto,
  CreateLocationDto,
  MarkItemDto,
  MoveItemDto,
  UpdateItemDto,
} from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Alta de item (M1). Folio legible INV-000123 (secuencia). Para aportación en
   * especie: costo = referencia del día × pct (default 70). Si no hay referencia
   * → 422 PRICE_PENDING + cola de precio pendiente (nunca se descarta).
   */
  async createItem(dto: CreateItemDto, actorUserId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');

    const gradeKey = this.pricing.gradeKeyFor(dto);
    let acquisitionCostCents = dto.acquisitionCostCents ?? null;
    let acquisitionPct = dto.acquisitionPct ?? null;

    if (dto.acquisitionType === 'aportacion_en_especie') {
      const pct = dto.acquisitionPct ?? (await this.settings.getNumber(SettingKey.APORTACION_PCT));
      const ref = await this.pricing.getReference(dto.cardId, dto.productType, gradeKey);
      if (ref.status !== 'priced' || ref.referenceMxnCents == null) {
        await this.pricing.escalatePending(dto.cardId, dto.productType, gradeKey, 'inventory');
        throw BusinessException.validation(
          'PRICE_PENDING',
          'No reference price yet; escalated to pending queue',
        );
      }
      acquisitionPct = pct;
      acquisitionCostCents = computeAportacionCostCents(ref.referenceMxnCents, pct);
    }

    const folio = await this.prisma.nextFolio();
    const item = await this.prisma.inventoryItem.create({
      data: {
        folio,
        cardId: dto.cardId,
        productType: dto.productType,
        rawCondition: dto.rawCondition,
        gradingCompany: dto.gradingCompany,
        gradeValue: dto.gradeValue,
        locationId: dto.locationId,
        frontPhotoKey: dto.frontPhotoKey,
        backPhotoKey: dto.backPhotoKey,
        extraPhotoKeys: dto.extraPhotoKeys ?? undefined,
        ownerType: 'platform',
        status: 'in_stock',
        acquisitionType: dto.acquisitionType,
        acquisitionPct,
        acquisitionCostCents,
        sourceSellRequestItemId: dto.sourceSellRequestItemId,
      },
    });
    await this.prisma.inventoryMovement.create({
      data: {
        itemId: item.id,
        toLocationId: dto.locationId,
        toStatus: 'in_stock',
        reason: MovementReason.alta,
        actorUserId,
        note: dto.acquisitionType,
      },
    });
    return { id: item.id, folio: item.folio, status: item.status, acquisitionCostCents };
  }

  async listItems(q: {
    status?: string;
    cardId?: string;
    ownerType?: string;
    locationId?: string;
    zone?: string;
    q?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.InventoryItemWhereInput = {};
    if (q.status) where.status = q.status as never;
    if (q.cardId) where.cardId = q.cardId;
    if (q.ownerType) where.ownerType = q.ownerType as never;
    if (q.locationId) where.locationId = q.locationId;
    if (q.zone) where.location = { zone: q.zone as never };
    if (q.q) where.OR = [{ folio: { contains: q.q, mode: 'insensitive' } }];
    const [data, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { card: true, location: true },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  async getItem(id: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        card: { include: { set: true } },
        location: true,
        movements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) throw BusinessException.notFound();
    return item;
  }

  async updateItem(id: string, dto: UpdateItemDto) {
    await this.getItem(id);
    return this.prisma.inventoryItem.update({ where: { id }, data: dto });
  }

  async moveItem(id: string, dto: MoveItemDto, actorUserId: string) {
    const item = await this.getItem(id);
    await this.prisma.inventoryMovement.create({
      data: {
        itemId: id,
        fromLocationId: item.locationId,
        toLocationId: dto.toLocationId,
        fromStatus: item.status,
        toStatus: item.status,
        reason: MovementReason.move,
        actorUserId,
        note: dto.note,
      },
    });
    return this.prisma.inventoryItem.update({
      where: { id },
      data: { locationId: dto.toLocationId },
    });
  }

  async markItem(id: string, dto: MarkItemDto, actorUserId: string) {
    const item = await this.getItem(id);
    const status: InventoryStatus = dto.mark === 'lost' ? 'lost' : 'damaged';
    await this.prisma.inventoryMovement.create({
      data: {
        itemId: id,
        fromStatus: item.status,
        toStatus: status,
        reason: dto.mark === 'lost' ? MovementReason.lost : MovementReason.damaged,
        actorUserId,
        note: dto.note,
      },
    });
    return this.prisma.inventoryItem.update({ where: { id }, data: { status } });
  }

  // ---------------- Locations ----------------

  async listLocations() {
    const data = await this.prisma.vaultLocation.findMany({ orderBy: { label: 'asc' } });
    return { data };
  }

  async createLocation(dto: CreateLocationDto) {
    const label = `${dto.box}-${dto.row}-${dto.slot}`;
    return this.prisma.vaultLocation.create({ data: { ...dto, label } });
  }
}

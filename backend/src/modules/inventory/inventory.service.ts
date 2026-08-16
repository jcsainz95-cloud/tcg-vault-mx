import { Injectable } from '@nestjs/common';
import { Finish, InventoryStatus, MovementReason, Prisma } from '@prisma/client';
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

    // v1.1: validación por tipo de producto (excluye sellado de la lógica NM/rareza/grade).
    this.validateProductShape(dto);

    // v1.6-finish: el acabado aplica a raw/singles; graded/sealed = normal siempre (ARCHITECTURE §3.7).
    // Para raw se valida contra card.availableFinishes (SEC-A1); fuera de la lista → 422.
    const finish = this.resolveFinish(dto, card.availableFinishes as Finish[]);

    const gradeKey = this.pricing.gradeKeyFor(dto);
    let acquisitionCostCents = dto.acquisitionCostCents ?? null;
    let acquisitionPct = dto.acquisitionPct ?? null;

    if (dto.acquisitionType === 'aportacion_en_especie') {
      const pct = dto.acquisitionPct ?? (await this.settings.getNumber(SettingKey.APORTACION_PCT));
      // v1.6-finish: costo contra la referencia del ACABADO alta.
      const ref = await this.pricing.getReference(dto.cardId, dto.productType, gradeKey, finish);
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

    // v1.1: sellado = precio SIEMPRE manual (MXN). Obligatorio para PUBLICAR: sin
    // listPriceCents el sellado queda "precio pendiente" (no aparece en Compra). Se escala
    // a la cola de precio pendiente para que el dueño lo fije (regla transversal).
    if (dto.productType === 'sealed' && dto.listPriceCents == null) {
      await this.pricing.escalatePending(dto.cardId, dto.productType, gradeKey, 'inventory');
    }

    const folio = await this.prisma.nextFolio();
    const item = await this.prisma.inventoryItem.create({
      data: {
        folio,
        cardId: dto.cardId,
        productType: dto.productType,
        // raw solo NM (default NM); sellado/graded no llevan rawCondition.
        rawCondition: dto.productType === 'raw' ? (dto.rawCondition ?? 'NM') : null,
        finish,
        sealedSubtype: dto.productType === 'sealed' ? (dto.sealedSubtype ?? null) : null,
        gradingCompany: dto.productType === 'graded' ? dto.gradingCompany : null,
        gradeValue: dto.productType === 'graded' ? dto.gradeValue : null,
        // v1.2 (M-12): certNumber solo para graded; null en raw/sealed.
        certNumber: dto.productType === 'graded' ? dto.certNumber : null,
        listPriceCents: dto.listPriceCents ?? null,
        locationId: dto.locationId,
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

  /**
   * v1.6-finish — resuelve/valida el acabado del alta (ARCHITECTURE §3.7):
   *  - graded/sealed → `normal` siempre (el acabado solo aplica a raw/singles).
   *  - raw → el finish del DTO (default normal), validado contra card.availableFinishes (SEC-A1);
   *    fuera de la lista → 422 FINISH_NOT_AVAILABLE.
   */
  private resolveFinish(dto: CreateItemDto, availableFinishes: Finish[]): Finish {
    if (dto.productType !== 'raw') return 'normal';
    const f = dto.finish ?? 'normal';
    const available = availableFinishes ?? ['normal'];
    if (!available.includes(f)) {
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        `Finish '${f}' is not available for this card`,
        { finish: f, availableFinishes: available },
      );
    }
    return f;
  }

  /**
   * v1.1 — coherencia por tipo de producto. El sellado NO lleva condición/grade/rareza;
   * el raw solo NM; el graded exige compañía+grado. Rechaza combinaciones inválidas con
   * 422 VALIDATION_ERROR (API_CONTRACT §M1).
   */
  private validateProductShape(dto: CreateItemDto) {
    if (dto.productType === 'sealed') {
      if (dto.rawCondition || dto.gradingCompany || dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'sealed items carry no rawCondition/grade',
        );
      }
    } else if (dto.productType === 'raw') {
      if (dto.rawCondition && dto.rawCondition !== 'NM') {
        throw BusinessException.validation('VALIDATION_ERROR', 'raw condition must be NM');
      }
      if (dto.sealedSubtype || dto.gradingCompany || dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'raw items carry no sealedSubtype/grade',
        );
      }
    } else {
      // graded
      if (!dto.gradingCompany || !dto.gradeValue) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items require gradingCompany and gradeValue',
        );
      }
      // v1.2 (M-12): certNumber (nº de certificado PSA/CGC) requerido para publicar una gradeada.
      if (!dto.certNumber || dto.certNumber.trim() === '') {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items require certNumber to be published',
        );
      }
      if (dto.rawCondition || dto.sealedSubtype) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          'graded items carry no rawCondition/sealedSubtype',
        );
      }
    }
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
    const current = await this.getItem(id);
    // v1.2 (M-12): la invariante "gradeada publicada exige certNumber" también rige en el
    // UPDATE, no solo en el alta. `createItem` valida vía validateProductShape; aquí revalidamos
    // el estado RESULTANTE del PATCH: si la carta resultante es graded y queda `listed`, el
    // certNumber resultante (nuevo si viene en el dto, si no el ya persistido) debe ser no vacío.
    // Sin esto un PATCH podría publicar/mantener publicada una gradeada sin cert → aparecería en
    // Compra sin nº de certificado verificable (API_CONTRACT §M1).
    const resultingStatus = dto.status ?? current.status;
    const resultingCertNumber =
      dto.certNumber !== undefined ? dto.certNumber : current.certNumber;
    if (
      current.productType === 'graded' &&
      resultingStatus === 'listed' &&
      (!resultingCertNumber || resultingCertNumber.trim() === '')
    ) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'graded items require certNumber to be published',
      );
    }
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

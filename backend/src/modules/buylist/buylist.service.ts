import { Injectable } from '@nestjs/common';
import { BuylistCategory, MovementReason, Prisma, ProductType, RawCondition } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { UsersService, isValidClabe } from '../users/users.service';
import { quoteAcquisition } from '../../common/money';

interface QuoteItemInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  category: BuylistCategory;
}

@Injectable()
export class BuylistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
  ) {}

  /** Cotizador público (stateless). API_CONTRACT §6. */
  async publicQuote(cardId: string, productType: ProductType, rawCondition?: RawCondition) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
    const category = await this.categoryForRarity(card.rarity);
    const gradeKey = this.pricing.gradeKeyFor({ productType, rawCondition });
    const ref = await this.pricing.getReference(cardId, productType, gradeKey);
    const referenceMxnCents =
      ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    const quote = quoteAcquisition(category, referenceMxnCents);
    return {
      category,
      quote: {
        status: quote.status,
        quotedPriceCents: quote.quotedPriceCents,
        currency: 'MXN' as const,
      },
      referencePrice:
        referenceMxnCents != null
          ? { status: 'priced' as const, priceMxnCents: referenceMxnCents }
          : { status: 'pending' as const },
      paymentNotice: 'PAY_AFTER_RECEIPT' as const,
    };
  }

  /** Deriva categoría desde la tabla rareza→categoría (dial M2/M10). */
  async categoryForRarity(rarity: string | null): Promise<BuylistCategory> {
    const map = (await this.settings.getRaw(SettingKey.RARITY_MAP)) as Record<string, string>;
    const cat = rarity ? map[rarity] : undefined;
    if (cat === 'reverse_holo') return 'reverse_holo';
    if (cat === 'ex_plus') return 'ex_plus';
    return 'comun';
  }

  /**
   * Crea la solicitud de venta. Valida topes (solicitud/mes), INE sobre tope y
   * CLABE a nombre propio. API_CONTRACT §6, PROJECT criterio 14.
   */
  async createRequest(
    userId: string,
    items: QuoteItemInput[],
    clabe: string,
    ineUploadKeys?: { front: string; back: string },
  ) {
    if (!isValidClabe(clabe)) {
      throw BusinessException.validation('CLABE_INVALID', 'CLABE must be 18 digits');
    }
    // La CLABE debe estar a nombre del propio usuario: se valida contra la KYC declarada.
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId } });
    if (kyc?.clabe && kyc.clabe !== clabe) {
      throw BusinessException.validation(
        'CLABE_NOT_OWN_NAME',
        'CLABE must match the one on file (own name)',
      );
    }

    // Cotiza cada item.
    const itemsData: {
      cardId: string;
      productType: ProductType;
      rawCondition?: RawCondition;
      category: BuylistCategory;
      quotedPriceCents: number | null;
      itemStatus: 'cotizada' | 'precio_pendiente';
    }[] = [];
    let quotedTotalCents = 0;
    for (const it of items) {
      const gradeKey = this.pricing.gradeKeyFor({ productType: it.productType, rawCondition: it.rawCondition });
      const ref = await this.pricing.getReference(it.cardId, it.productType, gradeKey);
      const referenceMxnCents =
        ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
      const q = quoteAcquisition(it.category, referenceMxnCents);
      if (q.status === 'precio_pendiente') {
        await this.pricing.escalatePending(it.cardId, it.productType, gradeKey, 'buylist');
      }
      quotedTotalCents += q.quotedPriceCents ?? 0;
      itemsData.push({
        cardId: it.cardId,
        productType: it.productType,
        rawCondition: it.rawCondition,
        category: it.category,
        quotedPriceCents: q.quotedPriceCents,
        itemStatus: q.status,
      });
    }

    // Topes.
    const capPerRequest =
      kyc?.capPerRequestCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS));
    const capPerMonth =
      kyc?.capPerMonthCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS));
    const ineThreshold = await this.settings.getNumber(SettingKey.INE_THRESHOLD_CENTS);

    if (quotedTotalCents > capPerRequest) {
      throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-request cap exceeded', {
        scope: 'per_request',
        capCents: capPerRequest,
        wouldBeCents: quotedTotalCents,
      });
    }
    const monthUsed = await this.users.monthUsedCents(userId);
    if (monthUsed + quotedTotalCents > capPerMonth) {
      throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month cap exceeded', {
        scope: 'per_month',
        capCents: capPerMonth,
        wouldBeCents: monthUsed + quotedTotalCents,
      });
    }

    // INE sobre el tope configurado.
    const ineProvided = Boolean(
      (ineUploadKeys?.front && ineUploadKeys?.back) || (kyc?.ineFrontKey && kyc?.ineBackKey),
    );
    const ineRequired = quotedTotalCents >= ineThreshold;
    if (ineRequired && !ineProvided) {
      throw BusinessException.validation('INE_REQUIRED', 'INE required above threshold', {
        thresholdCents: ineThreshold,
      });
    }

    // Persiste CLABE/INE en KYC declarada.
    await this.prisma.kycProfile.upsert({
      where: { userId },
      create: {
        userId,
        clabe,
        ineFrontKey: ineUploadKeys?.front,
        ineBackKey: ineUploadKeys?.back,
        kycStatus: 'pending',
      },
      update: {
        clabe,
        ...(ineUploadKeys?.front ? { ineFrontKey: ineUploadKeys.front } : {}),
        ...(ineUploadKeys?.back ? { ineBackKey: ineUploadKeys.back } : {}),
      },
    });

    const request = await this.prisma.sellRequest.create({
      data: {
        userId,
        status: 'cotizada',
        quotedTotalCents,
        clabeSnapshot: clabe,
        ineRequired,
        ineProvided,
        items: { create: itemsData },
      },
      include: { items: { include: { card: true } } },
    });

    return {
      sellRequestId: request.id,
      status: request.status,
      quotedTotalCents,
      ineRequired,
      items: request.items.map((i) => this.itemDTO(i)),
    };
  }

  private itemDTO(i: {
    id: string;
    card: { id: string; name: string; number: string } | null;
    cardId: string;
    productType: ProductType;
    rawCondition: RawCondition | null;
    category: BuylistCategory;
    quotedPriceCents: number | null;
    approvedPriceCents: number | null;
    itemStatus: string;
    inventoryItemId: string | null;
  }) {
    return {
      id: i.id,
      cardId: i.cardId,
      card: i.card,
      productType: i.productType,
      rawCondition: i.rawCondition ?? undefined,
      category: i.category,
      quotedPriceCents: i.quotedPriceCents ?? undefined,
      approvedPriceCents: i.approvedPriceCents ?? undefined,
      itemStatus: i.itemStatus,
      inventoryItemId: i.inventoryItemId ?? undefined,
    };
  }

  async listMine(userId: string) {
    const data = await this.prisma.sellRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  }

  async getMine(userId: string, id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: { items: { include: { card: true } } },
    });
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    return req;
  }

  /** Responde a un ajuste del admin (accept/decline). API_CONTRACT §6. */
  async respond(userId: string, id: string, decision: 'accept' | 'decline') {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    if (decision === 'decline') {
      return this.prisma.sellRequest.update({ where: { id }, data: { status: 'rechazada' } });
    }
    // accept: mueve items 'ajustada' a 'aprobada' y limpia el plazo de 7d.
    await this.prisma.sellRequestItem.updateMany({
      where: { sellRequestId: id, itemStatus: 'ajustada' },
      data: { itemStatus: 'aprobada' },
    });
    return this.prisma.sellRequest.update({
      where: { id },
      data: { adjustmentSentAt: null, status: 'aprobada', approvedAt: new Date() },
    });
  }

  // ---------------- Admin M5 ----------------

  async adminList(status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.SellRequestWhereInput = {};
    if (status) where.status = status as never;
    const [data, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: true },
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    return { data, page, pageSize, total };
  }

  async adminGet(id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: { items: { include: { card: true } } },
    });
    if (!req) throw BusinessException.notFound();
    return req;
  }

  async receive(id: string) {
    await this.adminGet(id);
    await this.prisma.sellRequestItem.updateMany({
      where: { sellRequestId: id, itemStatus: { in: ['cotizada', 'precio_pendiente'] } },
      data: { itemStatus: 'recibida' },
    });
    return this.prisma.sellRequest.update({
      where: { id },
      data: { status: 'recibida', receivedAt: new Date() },
    });
  }

  async verify(id: string) {
    await this.adminGet(id);
    await this.prisma.sellRequestItem.updateMany({
      where: { sellRequestId: id, itemStatus: 'recibida' },
      data: { itemStatus: 'verificacion' },
    });
    return this.prisma.sellRequest.update({
      where: { id },
      data: { status: 'verificacion', verifiedAt: new Date() },
    });
  }

  /** Cherry-pick: decisión carta por carta. API_CONTRACT §M5. */
  async itemDecision(
    itemId: string,
    decision: 'approve' | 'adjust' | 'reject',
    approvedPriceCents?: number,
  ) {
    const item = await this.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
    if (!item) throw BusinessException.notFound();
    let itemStatus: 'aprobada' | 'ajustada' | 'rechazada';
    const data: Prisma.SellRequestItemUpdateInput = {};
    if (decision === 'approve') {
      itemStatus = 'aprobada';
      data.approvedPriceCents = approvedPriceCents ?? item.quotedPriceCents ?? 0;
    } else if (decision === 'adjust') {
      itemStatus = 'ajustada';
      data.approvedPriceCents = approvedPriceCents ?? 0;
      // Dispara el plazo de 7 días en la solicitud.
      await this.prisma.sellRequest.update({
        where: { id: item.sellRequestId },
        data: { adjustmentSentAt: new Date() },
      });
    } else {
      itemStatus = 'rechazada';
    }
    data.itemStatus = itemStatus;
    return this.prisma.sellRequestItem.update({ where: { id: itemId }, data });
  }

  /** Conversión a inventario en un clic. API_CONTRACT §M5. */
  async convertToInventory(itemId: string, actorUserId: string) {
    const item = await this.prisma.sellRequestItem.findUnique({
      where: { id: itemId },
      include: { card: true },
    });
    if (!item) throw BusinessException.notFound();
    if (item.inventoryItemId) {
      return { inventoryItemId: item.inventoryItemId, alreadyConverted: true };
    }
    const folio = await this.prisma.nextFolio();
    const created = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.inventoryItem.create({
        data: {
          folio,
          cardId: item.cardId,
          productType: item.productType,
          rawCondition: item.rawCondition,
          ownerType: 'platform',
          status: 'in_stock',
          acquisitionType: 'buylist',
          acquisitionCostCents: item.approvedPriceCents ?? item.quotedPriceCents ?? 0,
          sourceSellRequestItemId: item.id,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          itemId: inv.id,
          toStatus: 'in_stock',
          reason: MovementReason.buylist_convert,
          actorUserId,
          note: `from sellRequestItem ${item.id}`,
        },
      });
      await tx.sellRequestItem.update({
        where: { id: itemId },
        data: { itemStatus: 'convertida_inventario', inventoryItemId: inv.id },
      });
      return inv;
    });
    return { inventoryItemId: created.id, folio: created.folio };
  }

  /**
   * Pago SPEI manual (super_admin, money-out). Precondición: aprobada + verificada.
   * API_CONTRACT §M5, PROJECT criterio 26.
   */
  async paySpei(id: string, speiReference: string, paidBy: string) {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req) throw BusinessException.notFound();
    if (!['aprobada', 'verificacion'].includes(req.status) || !req.verifiedAt) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Payment allowed only after receipt/verification and approval',
      );
    }
    return this.prisma.sellRequest.update({
      where: { id },
      data: { status: 'pagada', speiReference, paidBy, paidAt: new Date() },
    });
  }
}

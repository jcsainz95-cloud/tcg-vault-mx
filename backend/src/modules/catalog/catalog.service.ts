import { Injectable } from '@nestjs/common';
import { Card, CardSet, InventoryItem, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';

export function toCardDTO(card: Card & { set?: CardSet | null }) {
  return {
    id: card.id,
    externalId: card.externalId,
    name: card.name,
    number: card.number,
    rarity: card.rarity,
    supertype: card.supertype,
    subtypes: (card.subtypes as string[] | null) ?? [],
    setId: card.setId,
    setName: card.set?.name ?? null,
    imageSmallUrl: card.imageSmallUrl,
    imageLargeUrl: card.imageLargeUrl,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Construye un ListingDTO (API_CONTRACT §DTOs base). Distingue referenceValue
   * (valor de mercado) de salePriceCents (precio de venta = ref×(1+markup) u override).
   * sellable=false si precio pendiente.
   */
  async toListingDTO(item: InventoryItem & { card: Card & { set?: CardSet | null } }) {
    const gradeKey = this.pricing.gradeKeyFor(item);
    const referenceValue = await this.pricing.getReference(item.cardId, item.productType, gradeKey);

    let salePriceCents: number | undefined;
    if (item.listPriceCents != null) {
      salePriceCents = item.listPriceCents;
    } else if (referenceValue.status === 'priced' && referenceValue.referenceMxnCents != null) {
      salePriceCents = await this.pricing.computeSalePrice(referenceValue.referenceMxnCents);
    }

    const sellable =
      salePriceCents != null &&
      salePriceCents > 0 &&
      (item.status === 'listed' || item.status === 'in_stock');

    return {
      inventoryItemId: item.id,
      card: toCardDTO(item.card),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      gradingCompany: item.gradingCompany ?? undefined,
      gradeValue: item.gradeValue ?? undefined,
      referenceValue,
      salePriceCents,
      sellable,
      frontPhotoUrl: this.photoUrl(item.frontPhotoKey),
      backPhotoUrl: this.photoUrl(item.backPhotoKey),
    };
  }

  private photoUrl(key?: string | null): string | undefined {
    if (!key) return undefined;
    const base = process.env.S3_PUBLIC_BASE_URL ?? '';
    return `${base}/${key}`;
  }

  async listCards(q: {
    q?: string;
    setId?: string;
    rarity?: string;
    productType?: string;
    condition?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    page: number;
    pageSize: number;
    sort?: string;
  }) {
    // Storefront: solo items de la plataforma disponibles (listed/in_stock).
    const where: Prisma.InventoryItemWhereInput = {
      ownerType: 'platform',
      status: { in: ['listed', 'in_stock'] },
    };
    if (q.productType) where.productType = q.productType as never;
    if (q.condition) where.rawCondition = q.condition as never;
    if (q.setId) where.card = { setId: q.setId };
    if (q.rarity) where.card = { ...(where.card as object), rarity: q.rarity };
    if (q.q) {
      where.card = { ...(where.card as object), name: { contains: q.q, mode: 'insensitive' } };
    }
    if (q.minPriceCents != null || q.maxPriceCents != null) {
      where.listPriceCents = {
        ...(q.minPriceCents != null ? { gte: q.minPriceCents } : {}),
        ...(q.maxPriceCents != null ? { lte: q.maxPriceCents } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { card: { include: { set: true } } },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: q.sort === 'price_asc' ? { listPriceCents: 'asc' } : { createdAt: 'desc' },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    const data = await Promise.all(items.map((i) => this.toListingDTO(i)));
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  async getCard(cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { set: true },
    });
    if (!card) throw BusinessException.notFound();
    const items = await this.prisma.inventoryItem.findMany({
      where: { cardId, ownerType: 'platform', status: { in: ['listed', 'in_stock'] } },
      include: { card: { include: { set: true } } },
    });
    const listings = await Promise.all(items.map((i) => this.toListingDTO(i)));
    return { card: toCardDTO(card), listings };
  }

  async getListing(inventoryItemId: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: { card: { include: { set: true } } },
    });
    if (!item) throw BusinessException.notFound();
    return this.toListingDTO(item);
  }

  async listSets() {
    const data = await this.prisma.cardSet.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, series: true, releaseDate: true },
    });
    return { data };
  }
}

import { Injectable } from '@nestjs/common';
import { Card, CardSet, InventoryItem, Prisma, ProductType, RawCondition, SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';

// Conjuntos de valores válidos de los enums de Prisma. Un filtro público con un valor
// fuera de estos conjuntos produciría un PrismaClientValidationError (500); en cambio
// se rechaza con 400 VALIDATION_ERROR (ver `validateEnum`).
const PRODUCT_TYPES = new Set<string>(Object.values(ProductType));
const RAW_CONDITIONS = new Set<string>(Object.values(RawCondition));
const SEALED_SUBTYPES = new Set<string>(Object.values(SealedSubtype));

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

/** Deriva el año del set desde `releaseDate` (`yyyy/MM/dd` de pokemontcg.io). v1.1. */
export function yearFromReleaseDate(releaseDate?: string | null): number | null {
  if (!releaseDate) return null;
  const m = /^(\d{4})/.exec(releaseDate);
  return m ? parseInt(m[1], 10) : null;
}

type ItemWithCard = InventoryItem & { card: Card & { set?: CardSet | null } };

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * v1.1 — "Compra" = inventario PUBLICADO con precio de venta fijado (ARCHITECTURE §4.9):
   * `status=listed`, plataforma, y con un precio de venta RESOLVIBLE (listPriceCents fijado
   * u override, o referencia con la que calcular precio×markup). El comprador NUNCA ve
   * "precio pendiente".
   *
   * Gate coarse en DB (para acotar): el item tiene listPriceCents fijado O su carta tiene
   * alguna PriceReference. El precio EXACTO y la comprabilidad (`sellable`) se confirman al
   * construir el ListingDTO; los items sin precio resoluble se descartan.
   */
  private publishedWhere(extra: Prisma.InventoryItemWhereInput = {}): Prisma.InventoryItemWhereInput {
    return {
      ownerType: 'platform',
      status: 'listed',
      OR: [
        { listPriceCents: { not: null, gt: 0 } },
        { card: { priceReferences: { some: {} } } },
      ],
      ...extra,
    };
  }

  /** Trae items publicados que efectivamente son comprables (precio resoluble). */
  private async fetchSellable(
    where: Prisma.InventoryItemWhereInput,
  ): Promise<{ item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where,
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const out: { item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[] = [];
    for (const item of items) {
      const dto = await this.toListingDTO(item);
      if (dto.sellable && dto.salePriceCents != null) out.push({ item, dto });
    }
    return out;
  }

  /**
   * Construye un ListingDTO (API_CONTRACT §DTOs base). Distingue referenceValue
   * (valor de mercado) de salePriceCents (precio de venta). El sellado lleva sealedSubtype
   * y NO lleva rawCondition/grade/rareza.
   */
  async toListingDTO(item: ItemWithCard) {
    const gradeKey = this.pricing.gradeKeyFor(item);
    const referenceValue = await this.pricing.getReference(item.cardId, item.productType, gradeKey);

    let salePriceCents: number | undefined;
    if (item.listPriceCents != null) {
      salePriceCents = item.listPriceCents;
    } else if (referenceValue.status === 'priced' && referenceValue.referenceMxnCents != null) {
      salePriceCents = await this.pricing.computeSalePrice(referenceValue.referenceMxnCents);
    }

    // v1.1: comprable solo si está PUBLICADO (listed) y con precio de venta fijado (>0).
    const sellable = salePriceCents != null && salePriceCents > 0 && item.status === 'listed';

    return {
      inventoryItemId: item.id,
      card: toCardDTO(item.card),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      sealedSubtype: item.sealedSubtype ?? undefined,
      gradingCompany: item.gradingCompany ?? undefined,
      gradeValue: item.gradeValue ?? undefined,
      // v1.2 (M-12): nº de certificado PSA/CGC (verificable en la graduadora); null en raw/sealed.
      certNumber: item.certNumber ?? undefined,
      referenceValue,
      salePriceCents,
      sellable,
      // v1.2 (M-13): sin fotos propias — la imagen es la de catálogo remota (CardDTO.imageSmallUrl/Large).
    };
  }

  /**
   * Valida un valor de filtro enum del endpoint público. Devuelve el valor si es válido;
   * si no, lanza 400 VALIDATION_ERROR (nunca deja que un enum inválido llegue a Prisma y
   * produzca un 500 PrismaClientValidationError).
   */
  private validateEnum(field: string, value: string, allowed: Set<string>): string {
    if (!allowed.has(value)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `Invalid ${field} filter`, {
        field,
        value,
        allowed: [...allowed],
      });
    }
    return value;
  }

  async listCards(q: {
    q?: string;
    setId?: string;
    rarity?: string;
    productType?: string;
    condition?: string;
    sealedSubtype?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    page: number;
    pageSize: number;
    sort?: string;
  }) {
    // Endpoint PÚBLICO: los filtros enum se validan contra la taxonomía real ANTES de
    // llegar a Prisma. Un valor inválido (p. ej. ?condition=LP, ?productType=foo) hoy
    // rompía con PrismaClientValidationError (500); ahora responde 400 VALIDATION_ERROR.
    const extra: Prisma.InventoryItemWhereInput = {};
    if (q.productType) extra.productType = this.validateEnum('productType', q.productType, PRODUCT_TYPES) as never;
    if (q.condition) extra.rawCondition = this.validateEnum('condition', q.condition, RAW_CONDITIONS) as never;
    if (q.sealedSubtype) extra.sealedSubtype = this.validateEnum('sealedSubtype', q.sealedSubtype, SEALED_SUBTYPES) as never;
    const cardWhere: Prisma.CardWhereInput = {};
    if (q.setId) cardWhere.setId = q.setId;
    if (q.rarity) cardWhere.rarity = q.rarity;
    if (q.q) cardWhere.name = { contains: q.q, mode: 'insensitive' };
    if (Object.keys(cardWhere).length) extra.card = cardWhere;

    let rows = await this.fetchSellable(this.publishedWhere(extra));

    // Rango de precio sobre el PRECIO DE VENTA (que puede derivar de la referencia).
    if (q.minPriceCents != null) rows = rows.filter((r) => (r.dto.salePriceCents ?? 0) >= q.minPriceCents!);
    if (q.maxPriceCents != null) rows = rows.filter((r) => (r.dto.salePriceCents ?? 0) <= q.maxPriceCents!);

    if (q.sort === 'price_asc') {
      rows.sort((a, b) => (a.dto.salePriceCents ?? 0) - (b.dto.salePriceCents ?? 0));
    } else if (q.sort === 'price_desc') {
      rows.sort((a, b) => (b.dto.salePriceCents ?? 0) - (a.dto.salePriceCents ?? 0));
    }
    // 'newest' (default) ya viene por createdAt desc del fetch.

    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    const data = rows.slice(start, start + q.pageSize).map((r) => r.dto);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  /**
   * v1.1 — Facetas dinámicas de "Compra" calculadas SOBRE el inventario publicado y
   * comprable (no el catálogo completo). API_CONTRACT §catalog/facets.
   */
  async facets() {
    const rows = await this.fetchSellable(this.publishedWhere());

    const rarities = [...new Set(rows.map((r) => r.item.card.rarity).filter((x): x is string => Boolean(x)))];
    const productTypes = [...new Set(rows.map((r) => r.item.productType))];
    const sealedSubtypes = [
      ...new Set(rows.map((r) => r.item.sealedSubtype).filter((x): x is NonNullable<typeof x> => Boolean(x))),
    ];

    const setMap = new Map<string, { id: string; name: string; releaseDate: string | null; year: number | null }>();
    for (const { item } of rows) {
      const s = item.card.set;
      if (s && !setMap.has(s.id)) {
        setMap.set(s.id, { id: s.id, name: s.name, releaseDate: s.releaseDate ?? null, year: yearFromReleaseDate(s.releaseDate) });
      }
    }
    const sets = [...setMap.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const prices = rows.map((r) => r.dto.salePriceCents ?? 0);
    return {
      rarities,
      sets,
      productTypes,
      sealedSubtypes,
      price: {
        minCents: prices.length ? Math.min(...prices) : 0,
        maxCents: prices.length ? Math.max(...prices) : 0,
        currency: 'MXN' as const,
      },
    };
  }

  async getCard(cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { set: true },
    });
    if (!card) throw BusinessException.notFound();
    const rows = await this.fetchSellable(this.publishedWhere({ cardId }));
    return { card: toCardDTO(card), listings: rows.map((r) => r.dto) };
  }

  async getListing(inventoryItemId: string) {
    // v1.1: un item no publicado / sin precio resoluble NO es visible en Compra → 404.
    const rows = await this.fetchSellable(this.publishedWhere({ id: inventoryItemId }));
    if (rows.length === 0) throw BusinessException.notFound();
    return rows[0].dto;
  }

  /** Sets con inventario publicado y comprable, con `year` derivado, ordenados por año desc. v1.1. */
  async listSets() {
    const rows = await this.fetchSellable(this.publishedWhere());
    const setMap = new Map<
      string,
      { id: string; name: string; series: string | null; releaseDate: string | null; year: number | null }
    >();
    for (const { item } of rows) {
      const s = item.card.set;
      if (s && !setMap.has(s.id)) {
        setMap.set(s.id, {
          id: s.id,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          year: yearFromReleaseDate(s.releaseDate),
        });
      }
    }
    const data = [...setMap.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { data };
  }
}

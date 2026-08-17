import { Injectable } from '@nestjs/common';
import { Card, CardSet, Finish, InventoryItem, Prisma, ProductType, RawCondition, SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';

// Conjuntos de valores válidos de los enums de Prisma. Un filtro público con un valor
// fuera de estos conjuntos produciría un PrismaClientValidationError (500); en cambio
// se rechaza con 400 VALIDATION_ERROR (ver `validateEnum`).
const PRODUCT_TYPES = new Set<string>(Object.values(ProductType));
const RAW_CONDITIONS = new Set<string>(Object.values(RawCondition));
const SEALED_SUBTYPES = new Set<string>(Object.values(SealedSubtype));
const FINISHES = new Set<string>(Object.values(Finish));

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
    // v1.6-finish: acabados en que existe la carta (lista blanca de validación). [normal] por default.
    availableFinishes: (card.availableFinishes ?? ['normal']) as Finish[],
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
   * v1.1 — "Compra" = inventario PUBLICADO con precio de venta RESOLVIBLE (ARCHITECTURE §4.9):
   * `status=listed`, plataforma. El comprador NUNCA ve "precio pendiente".
   *
   * v1.13-sales-pricing (§4.14d): el gate coarse en DB YA NO puede filtrar por existencia de precio.
   * Con las reglas de venta por rareza, una regla `fixed` da PISO a una carta bulk SIN `PriceReference`
   * (antes se excluía), volviéndola sellable — la resolubilidad depende de `SALES_PRICE_RULES`, que la
   * DB no evalúa. Por eso el gate coarse se reduce a `platform + listed`; el precio EXACTO y la
   * comprabilidad (`sellable`) se confirman al construir el ListingDTO (`fetchSellable` descarta los no
   * resolubles: `pct` sin market → pending → no vendible).
   */
  private publishedWhere(extra: Prisma.InventoryItemWhereInput = {}): Prisma.InventoryItemWhereInput {
    return {
      ownerType: 'platform',
      status: 'listed',
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
    // v1.6-finish: valúa contra la PriceReference del ACABADO de ESTA copia física.
    const referenceValue = await this.pricing.getReference(
      item.cardId,
      item.productType,
      gradeKey,
      item.finish,
    );

    let salePriceCents: number | undefined;
    if (item.listPriceCents != null) {
      // Override manual → gana siempre (precio directo sin regla).
      salePriceCents = item.listPriceCents;
    } else {
      // v1.13-sales-pricing (§4.14d): precio de venta por RAREZA (SEC-A1: rareza de Card.rarity,
      // acabado de InventoryItem.finish). Con regla `fixed` una bulk SIN market obtiene piso (sellable);
      // con `pct` sin market → pending (sin precio, no vendible), igual que antes.
      const referenceMxnCents =
        referenceValue.status === 'priced' ? (referenceValue.referenceMxnCents ?? null) : null;
      const sale = await this.pricing.computeSalePriceForItem(
        { rarity: item.card.rarity, finish: item.finish },
        referenceMxnCents,
      );
      if (sale.salePriceCents != null) salePriceCents = sale.salePriceCents;
    }

    // v1.1: comprable solo si está PUBLICADO (listed) y con precio de venta fijado (>0).
    const sellable = salePriceCents != null && salePriceCents > 0 && item.status === 'listed';

    return {
      inventoryItemId: item.id,
      card: toCardDTO(item.card),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      sealedSubtype: item.sealedSubtype ?? undefined,
      // v1.6-finish: acabado de esta copia (graded/sealed → normal). ListingDTO.finish.
      finish: item.finish,
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
    finish?: string;
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
    // v1.6-finish: filtro por acabado sobre InventoryItem.finish. Valor inválido → 400.
    if (q.finish) extra.finish = this.validateEnum('finish', q.finish, FINISHES) as never;
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
    // v1.6-finish: distinct de InventoryItem.finish sobre el inventario publicado (filtro de acabado).
    const finishes = [...new Set(rows.map((r) => r.item.finish))];
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
      finishes,
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

  /**
   * v1.3 — Búsqueda pública sobre TODA la tabla `Card` para el picker del cotizador
   * (API_CONTRACT §6 `GET /buylist/cards`). A diferencia de `listCards` ("Compra"), NO
   * filtra por inventario ni por precio: **cualquier** carta importada es cotizable, aunque
   * NO la tengamos en bóveda. Se reutiliza `CardDTO` (sin `sellable`/`salePriceCents`).
   */
  async searchAllCards(params: {
    setId?: string;
    q?: string;
    rarity?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.CardWhereInput = {};
    if (params.setId) where.setId = params.setId;
    if (params.rarity) where.rarity = params.rarity;
    if (params.q) {
      // Coincide con nombre (contains, case-insensitive) y/o número de carta.
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { number: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    const skip = (params.page - 1) * params.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.card.findMany({
        where,
        include: { set: true },
        orderBy: [{ name: 'asc' }, { number: 'asc' }],
        skip,
        take: params.pageSize,
      }),
      this.prisma.card.count({ where }),
    ]);
    return { data: rows.map((c) => toCardDTO(c)), page: params.page, pageSize: params.pageSize, total };
  }

  /**
   * v1.3 — Sets que tienen cartas importadas (API_CONTRACT §6 `GET /buylist/sets`), para
   * poblar el dropdown del cotizador. A diferencia de `listSets` (solo sets con inventario
   * publicado), aquí aparecen TODOS los sets del catálogo con al menos una carta. `year`
   * derivado de `releaseDate`; ordenados por año desc.
   */
  async listSetsWithImportedCards() {
    const sets = await this.prisma.cardSet.findMany({
      where: { cards: { some: {} } },
      select: { id: true, name: true, series: true, releaseDate: true },
    });
    const data = sets
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series ?? null,
        releaseDate: s.releaseDate ?? null,
        year: yearFromReleaseDate(s.releaseDate),
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { data };
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

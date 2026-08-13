import { Injectable, Logger } from '@nestjs/common';
import { Card, PriceReference, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { FxService } from './fx.service';
import { PokemonTcgIoProvider } from './providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from './providers/graded-sealed.providers';
import { PricingProvider, PriceSourceStr, buildGradeKey } from './pricing.types';
import { usdToMxnCents } from '../../common/money';

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export interface PriceInfo {
  status: 'priced' | 'pending';
  referenceMxnCents?: number;
  source?: PriceSourceStr;
  capturedDate?: string;
}

/**
 * PricingService — Orquesta el pricing (ARCHITECTURE §4.1):
 * 1. Elige provider por productType (dial M10).
 * 2. Cache diario: revisa PriceReference del día antes de llamar la API.
 * 3. Aplica FX + colchón para priceMxnCents.
 * 4. Si null y sin override → PendingPriceEntry (precio pendiente, escala al dueño).
 * Solo se pricea la bóveda (el llamador pasa cartas en bóveda).
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private readonly providers: PricingProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    tcgIo: PokemonTcgIoProvider,
    ppt: PokemonPriceTrackerProvider,
    poketrace: PokeTraceProvider,
  ) {
    this.providers = [tcgIo, ppt, poketrace];
  }

  private async providerFor(productType: ProductType): Promise<PricingProvider | undefined> {
    const key =
      productType === 'raw'
        ? SettingKey.PRICING_PROVIDER_RAW
        : productType === 'graded'
          ? SettingKey.PRICING_PROVIDER_GRADED
          : SettingKey.PRICING_PROVIDER_SEALED;
    const wanted = await this.settings.getString(key);
    return this.providers.find((p) => p.source === wanted && p.supports(productType));
  }

  /** Lee la referencia vigente (del día) para una carta/tipo/grado. */
  async getReference(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
  ): Promise<PriceInfo> {
    const ref = await this.prisma.priceReference.findFirst({
      where: { cardId, productType, gradeKey },
      orderBy: { capturedDate: 'desc' },
    });
    if (!ref) return { status: 'pending' };
    return {
      status: 'priced',
      referenceMxnCents: ref.priceMxnCents,
      source: ref.source as PriceSourceStr,
      capturedDate: ref.capturedDate.toISOString().slice(0, 10),
    };
  }

  /**
   * Sincroniza el precio de una carta (cache diario). Devuelve el PriceInfo.
   * Si no hay precio y no hay override → crea PendingPriceEntry (no descarta).
   */
  async syncCardPrice(
    card: Card,
    productType: ProductType,
    gradeKey: string,
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory' = 'inventory',
    refId?: string,
  ): Promise<PriceInfo> {
    // Cache diario: ¿ya hay fila de hoy?
    const existing = await this.prisma.priceReference.findUnique({
      where: {
        cardId_productType_gradeKey_capturedDate: {
          cardId: card.id,
          productType,
          gradeKey,
          capturedDate: today(),
        },
      },
    });
    if (existing) {
      return {
        status: 'priced',
        referenceMxnCents: existing.priceMxnCents,
        source: existing.source as PriceSourceStr,
        capturedDate: existing.capturedDate.toISOString().slice(0, 10),
      };
    }

    const provider = await this.providerFor(productType);
    const quote = provider ? await provider.fetchPrice({ card, productType, gradeKey }) : null;

    if (!quote || (quote.priceUsdCents == null && quote.priceMxnCents == null)) {
      await this.escalatePending(card.id, productType, gradeKey, context, refId);
      return { status: 'pending' };
    }

    let priceMxnCents: number;
    let priceUsdCents: number | null = null;
    let fxRate: number | null = null;
    let fxBufferPct: number | null = null;
    if (quote.priceMxnCents != null) {
      priceMxnCents = quote.priceMxnCents;
    } else {
      const fx = await this.fx.getCurrent();
      priceUsdCents = quote.priceUsdCents!;
      fxRate = fx.rate;
      fxBufferPct = fx.bufferPct;
      priceMxnCents = usdToMxnCents(priceUsdCents, fx.rate, fx.bufferPct);
    }

    const ref = await this.prisma.priceReference.create({
      data: {
        cardId: card.id,
        productType,
        gradeKey,
        source: quote.source,
        priceUsdCents,
        fxRate,
        fxBufferPct,
        priceMxnCents,
        capturedDate: today(),
        isManualOverride: false,
      },
    });
    return {
      status: 'priced',
      referenceMxnCents: ref.priceMxnCents,
      source: ref.source as PriceSourceStr,
      capturedDate: ref.capturedDate.toISOString().slice(0, 10),
    };
  }

  /** Cola de precio pendiente (transversal: nunca se descarta la carta). */
  async escalatePending(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory',
    refId?: string,
  ): Promise<void> {
    const open = await this.prisma.pendingPriceEntry.findFirst({
      where: { cardId, productType, gradeKey, status: 'open' },
    });
    if (open) return;
    await this.prisma.pendingPriceEntry.create({
      data: { cardId, productType, gradeKey, context, refId, status: 'open' },
    });
  }

  /** Override manual del admin (respaldo siempre disponible). Resuelve pendientes. */
  async manualOverride(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    priceMxnCents: number,
  ): Promise<PriceReference> {
    const ref = await this.prisma.priceReference.upsert({
      where: {
        cardId_productType_gradeKey_capturedDate: {
          cardId,
          productType,
          gradeKey,
          capturedDate: today(),
        },
      },
      create: {
        cardId,
        productType,
        gradeKey,
        source: 'manual',
        priceMxnCents,
        capturedDate: today(),
        isManualOverride: true,
      },
      update: { source: 'manual', priceMxnCents, isManualOverride: true },
    });
    await this.prisma.pendingPriceEntry.updateMany({
      where: { cardId, productType, gradeKey, status: 'open' },
      data: { status: 'resolved', resolvedPriceRefId: ref.id, resolvedAt: new Date() },
    });
    return ref;
  }

  async pendingQueue() {
    const data = await this.prisma.pendingPriceEntry.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'asc' },
    });
    return { data };
  }

  async priceHistory(cardId: string) {
    return this.prisma.priceReference.findMany({
      where: { cardId },
      orderBy: { capturedDate: 'desc' },
    });
  }

  /** Precio de venta = referencia × (1 + markup). ARCHITECTURE §10.1. */
  async computeSalePrice(referenceMxnCents: number): Promise<number> {
    const markup = await this.settings.getNumber(SettingKey.SALES_MARKUP_PCT);
    return Math.round(referenceMxnCents * (1 + markup / 100));
  }

  gradeKeyFor(item: {
    productType: ProductType;
    rawCondition?: string | null;
    gradingCompany?: string | null;
    gradeValue?: string | null;
  }): string {
    return buildGradeKey(item);
  }
}

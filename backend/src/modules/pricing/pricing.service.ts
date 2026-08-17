import { Injectable, Logger } from '@nestjs/common';
import { Card, Finish, PriceReference, ProductType } from '@prisma/client';
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
import {
  usdToMxnCents,
  computeSalePriceForRarity,
  SalePriceResult,
  SalesRule,
} from '../../common/money';

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

  /**
   * Lee la referencia vigente más reciente (sin filtro de fecha, `capturedDate desc`) para una
   * carta/tipo/grado/ACABADO, en paridad con la valuación del cliente (HoldingDTO).
   * v1.6-finish: `finish` es una columna ortogonal a `gradeKey` (default `normal` para
   * graded/sealed y compatibilidad). Cada acabado tiene su propia PriceReference.
   */
  async getReference(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    finish: Finish = 'normal',
  ): Promise<PriceInfo> {
    const ref = await this.prisma.priceReference.findFirst({
      where: { cardId, productType, gradeKey, finish },
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
   * v1.16-master-set (§4.17c) — cierra **RB-8/BE-4/D3**. Resuelve la "referencia vigente = MÁS
   * RECIENTE por acabado" para N ítems en **1** query (en vez de N `getReference`). Devuelve un
   * `Map` clave `cardId|productType|gradeKey|finish` → PriceInfo (missing = pending).
   *
   * Misma regla de valuación que `getReference` (sin filtro de fecha, `capturedDate desc`, primera
   * fila por clave). La usan `bulk-publish` y `fetchSellable` (pago mínimo de BE-25); disponible para
   * `holdings`/`ownedItemRefs`/`inventoryValue` (deuda diferida, misma dirección).
   */
  async getReferencesBatch(
    items: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[],
  ): Promise<Map<string, PriceInfo>> {
    const map = new Map<string, PriceInfo>();
    if (items.length === 0) return map;
    const keyOf = (i: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }) =>
      `${i.cardId}|${i.productType}|${i.gradeKey}|${i.finish}`;
    const wanted = new Set(items.map(keyOf));
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardId: { in: [...new Set(items.map((i) => i.cardId))] },
        productType: { in: [...new Set(items.map((i) => i.productType))] },
        gradeKey: { in: [...new Set(items.map((i) => i.gradeKey))] },
        finish: { in: [...new Set(items.map((i) => i.finish))] },
      },
      orderBy: { capturedDate: 'desc' },
      select: {
        cardId: true,
        productType: true,
        gradeKey: true,
        finish: true,
        priceMxnCents: true,
        source: true,
        capturedDate: true,
      },
    });
    for (const r of rows) {
      const k = keyOf(r);
      if (!wanted.has(k) || map.has(k)) continue; // primera vista = más reciente (orden desc)
      map.set(k, {
        status: 'priced',
        referenceMxnCents: r.priceMxnCents,
        source: r.source as PriceSourceStr,
        capturedDate: r.capturedDate.toISOString().slice(0, 10),
      });
    }
    return map;
  }

  /**
   * v1.16-master-set (BE-25, pago mínimo) — iza `SALES_PRICE_RULES` + fallback en **1** par de
   * lecturas por request (en vez de 2 lecturas de settings por ítem). Lo usan `bulk-publish` y
   * `fetchSellable` con `computeSalePriceForRarity` (pura) para evitar el N+1 de settings.
   */
  async loadSalesRules(): Promise<{ rules: Record<string, SalesRule>; fallbackPct: number }> {
    const rules =
      ((await this.settings.getRaw(SettingKey.SALES_PRICE_RULES)) as Record<string, SalesRule> | null) ?? {};
    const fallbackPct = await this.settings.getNumber(SettingKey.SALES_PRICE_FALLBACK_PCT);
    return { rules, fallbackPct };
  }

  /**
   * Sincroniza el precio de una carta (cache diario). Devuelve el PriceInfo.
   * Si no hay precio y no hay override → crea PendingPriceEntry (no descarta).
   */
  async syncCardPrice(
    card: Card,
    productType: ProductType,
    gradeKey: string,
    finish: Finish = 'normal',
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory' = 'inventory',
    refId?: string,
    // v1.9-set-chart: el `set-price-sync` precia TODO el set destacado (agregación de
    // mercado/marketing, no bóveda). Con `escalate=false` una carta sin precio NO se encola en
    // PendingPriceEntry (ARCHITECTURE §4.12a: no inundar la cola con todo el catálogo del set).
    // Los flujos de bóveda/buylist siguen con el default `true` (nunca se descarta una carta).
    escalate = true,
  ): Promise<PriceInfo> {
    // Cache diario: ¿ya hay fila de hoy para ESTE acabado?
    const existing = await this.prisma.priceReference.findUnique({
      where: {
        cardId_productType_gradeKey_finish_capturedDate: {
          cardId: card.id,
          productType,
          gradeKey,
          finish,
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
    const quote = provider ? await provider.fetchPrice({ card, productType, gradeKey, finish }) : null;

    if (!quote || (quote.priceUsdCents == null && quote.priceMxnCents == null)) {
      // v1.8-ronda-c FIX: propaga `finish` a la cola de pendientes. Antes se encolaba sin acabado,
      // colapsando `normal`/`holofoil` de la misma carta en UNA entrada al escalar.
      // v1.9-set-chart: `escalate=false` (set-price-sync) NO encola pendientes (§4.12a).
      if (escalate) {
        await this.escalatePending(card.id, productType, gradeKey, context, refId, finish);
      }
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
        finish,
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

  /**
   * Cola de precio pendiente (transversal: nunca se descarta la carta).
   * v1.8-ronda-c (M-19): la cola es POR ACABADO. `finish` entra a la clave de dedupe y a la fila
   * creada, para que `normal` y `holofoil` de la misma carta sean entradas SEPARADAS.
   */
  async escalatePending(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    context: 'catalog' | 'portfolio' | 'buylist' | 'inventory',
    refId?: string,
    finish: Finish = 'normal',
  ): Promise<void> {
    const open = await this.prisma.pendingPriceEntry.findFirst({
      where: { cardId, productType, gradeKey, finish, status: 'open' },
    });
    if (open) return;
    await this.prisma.pendingPriceEntry.create({
      data: { cardId, productType, gradeKey, finish, context, refId, status: 'open' },
    });
  }

  /**
   * v1.12-catalog-pricing (§4.13a) → GENERALIZADO por WS-A (v1.14-price-ingest, §4.15c/§4.15g).
   * Pobla `PriceReference` de MERCADO de una carta/acabado. Upsert idempotente por día sobre la
   * clave `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`.
   *
   * WS-A: antes hardcodeaba `source='pokemontcg_io'` y asumía USD. Ahora acepta `source`
   * (`PriceSource`) y `currency` para servir también al ingest del proveedor de PAGA:
   *  - `currency==='USD'` → convierte con `usdToMxnCents(market, fx.rate, fx.bufferPct)` (colchón #13),
   *    guarda `priceUsdCents` + `fxRate`/`fxBufferPct` (trazabilidad de la conversión).
   *  - `currency==='MXN'` → SIN conversión ni colchón (el colchón es un cushion del riesgo FX
   *    USD→MXN; si el proveedor ya da MXN no hay FX que amortiguar). `priceUsdCents`/`fx*` = null.
   *
   * - **NO pisa overrides manuales:** si la fila de hoy existe con `isManualOverride=true`, hace
   *   **skip** (el override del admin manda, §4.1).
   * - **NO escala pendientes:** este flujo (catálogo completo) nunca encola `PendingPriceEntry`.
   *   El llamador solo invoca este método cuando hay `market > 0` (validado por el adapter).
   * - **FX pre-cargado:** recibe el snapshot `{ rate, bufferPct }` cargado una sola vez por corrida
   *   (no llama `FxService` por carta) — FX una vez por corrida (§4.15f).
   */
  async persistMarketReference(
    cardId: string,
    finish: Finish,
    market: { marketCents: number; currency: 'USD' | 'MXN'; source: PriceSourceStr },
    fx: { rate: number; bufferPct: number },
  ): Promise<void> {
    const productType: ProductType = 'raw';
    const gradeKey = 'raw:NM';
    const capturedDate = today();
    const key = {
      cardId_productType_gradeKey_finish_capturedDate: {
        cardId,
        productType,
        gradeKey,
        finish,
        capturedDate,
      },
    };
    const existing = await this.prisma.priceReference.findUnique({ where: key });
    // No clobbea el override manual del admin (§4.1): si hay override de hoy, se respeta.
    if (existing?.isManualOverride) return;
    const isUsd = market.currency === 'USD';
    const priceMxnCents = isUsd
      ? usdToMxnCents(market.marketCents, fx.rate, fx.bufferPct)
      : market.marketCents;
    const priceUsdCents = isUsd ? market.marketCents : null;
    const fxRate = isUsd ? fx.rate : null;
    const fxBufferPct = isUsd ? fx.bufferPct : null;
    const data = {
      source: market.source,
      priceUsdCents,
      fxRate,
      fxBufferPct,
      priceMxnCents,
      isManualOverride: false,
    };
    await this.prisma.priceReference.upsert({
      where: key,
      create: { cardId, productType, gradeKey, finish, capturedDate, ...data },
      update: data,
    });
  }

  /** Override manual del admin (respaldo siempre disponible). Resuelve pendientes. */
  async manualOverride(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    priceMxnCents: number,
    finish: Finish = 'normal',
  ): Promise<PriceReference> {
    const ref = await this.prisma.priceReference.upsert({
      where: {
        cardId_productType_gradeKey_finish_capturedDate: {
          cardId,
          productType,
          gradeKey,
          finish,
          capturedDate: today(),
        },
      },
      create: {
        cardId,
        productType,
        gradeKey,
        finish,
        source: 'manual',
        priceMxnCents,
        capturedDate: today(),
        isManualOverride: true,
      },
      update: { source: 'manual', priceMxnCents, isManualOverride: true },
    });
    // v1.8-ronda-c FIX: resuelve SOLO el pendiente de ESTE acabado. Antes el where omitía
    // `finish`, así que un override de `normal` cerraba también el pendiente de `holofoil`.
    await this.prisma.pendingPriceEntry.updateMany({
      where: { cardId, productType, gradeKey, finish, status: 'open' },
      data: { status: 'resolved', resolvedPriceRefId: ref.id, resolvedAt: new Date() },
    });
    return ref;
  }

  /**
   * Cola de pendientes para M2 (`GET /admin/pricing/pending`).
   * Tier 0 FIX: incluye la carta (con set) — antes el findMany no hacía `include` y el DTO
   * llegaba sin `cardName`, así que el frontend pintaba el UUID. Shape por entrada: todos los
   * campos del modelo `PendingPriceEntry` (incluido `finish`, M-19) + `cardName` (conveniencia
   * plana que consume el front) + `card { id, name, number, setName }`.
   */
  async pendingQueue() {
    const rows = await this.prisma.pendingPriceEntry.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'asc' },
      include: { card: { include: { set: true } } },
    });
    const data = rows.map(({ card, ...entry }) => ({
      ...entry,
      cardName: card.name,
      card: {
        id: card.id,
        name: card.name,
        number: card.number,
        setName: card.set.name,
      },
    }));
    return { data };
  }

  async priceHistory(cardId: string) {
    return this.prisma.priceReference.findMany({
      where: { cardId },
      orderBy: { capturedDate: 'desc' },
    });
  }

  /**
   * @deprecated v1.13-sales-pricing (§4.14d): reemplazado por `computeSalePriceForItem` (precio de
   * venta por RAREZA). Ya NO lo llama la ruta de venta (los 2 call-sites migraron: catalog.toListingDTO
   * y orders.salePriceOf). Se conserva como palanca de ROLLBACK del markup GLOBAL único
   * (SALES_MARKUP_PCT). Retiro definitivo = follow-up del humano (decisión abierta v1.13-3).
   *
   * Precio de venta = referencia × (1 + markup). ARCHITECTURE §10.1.
   */
  async computeSalePrice(referenceMxnCents: number): Promise<number> {
    const markup = await this.settings.getNumber(SettingKey.SALES_MARKUP_PCT);
    return Math.round(referenceMxnCents * (1 + markup / 100));
  }

  /**
   * v1.13-sales-pricing (§4.14d) — precio de VENTA por RAREZA. Lee la tabla `SALES_PRICE_RULES` + el
   * fallback y aplica `computeSalePriceForRarity` (que reusa el gate premium de Fase 0).
   *
   * - `rarity` sale de `Card.rarity` (BD) y `finish` de `InventoryItem.finish` (BD) — SEC-A1, nunca del
   *   cliente. `referenceMxnCents` es la `PriceReference` del ACABADO del item (getReference(...,finish)).
   * - Con una regla `fixed`, una carta bulk SIN market obtiene precio de venta (piso) → puede ser
   *   sellable. Con `pct` sin market → `pending` (sin precio; igual que hoy).
   */
  async computeSalePriceForItem(
    item: { rarity: string | null; finish: Finish },
    referenceMxnCents: number | null,
  ): Promise<SalePriceResult> {
    const { rules, fallbackPct } = await this.loadSalesRules();
    return computeSalePriceForRarity(item.rarity, item.finish, referenceMxnCents, rules, fallbackPct);
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

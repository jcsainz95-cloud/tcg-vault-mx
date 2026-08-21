import { Injectable, Logger, Optional } from '@nestjs/common';
import { Card, Finish, PriceReference, ProductType, VariantPriceOverride } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { FxService } from './fx.service';
import { PokemonTcgIoProvider } from './providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from './providers/graded-sealed.providers';
import { PokemonPriceTrackerBulkProvider } from './providers/pokemonpricetracker-bulk.provider';
import {
  FreshCardPriceProvider,
  FreshCardRef,
  PricingProvider,
  PriceSourceStr,
  buildGradeKey,
  sealedMarketGradeKey,
} from './pricing.types';
import {
  usdToMxnCents,
  computeSalePriceForRarity,
  computeSealedSalePrice,
  BuylistRule,
  SalePriceResult,
  SalesRule,
  SealedSpreadResult,
  VariantPriceControls,
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
 * v1.26 (P-7 ⑤, §4.24e) — resultado de `refreshCardPrices`: qué cartas obtuvieron una referencia
 * FRESCA (`refreshed`) vs cuáles se quedaron sin precio nuevo (`pending`, caen a la ref almacenada).
 * `dailyLimited` = el proveedor de PAGA agotó su cuota diaria (parada; el resto queda pending).
 */
export interface RefreshCardPricesResult {
  refreshed: string[];
  pending: string[];
  dailyLimited: boolean;
}

/** v1.26 (P-7 ⑤) — cota DURA de cartas por llamada de reprecio fresco (nunca un barrido). */
export const MAX_FRESH_REPRICE_CARDS = 50;

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
    // v1.26 (P-7 ⑤): proveedores del fetch FRESCO puntual. PPT PRIMARIO (cuota diaria, por
    // `tcgplayerId`), pokemontcg.io FALLBACK (por `externalId`, reusa el `tcgIo` ya inyectado).
    // `@Optional()` para no romper los call-sites que construyen el servicio con los 6 args previos.
    @Optional() pptBulk?: PokemonPriceTrackerBulkProvider,
  ) {
    this.providers = [tcgIo, ppt, poketrace];
    // Orden de fetch fresco: PRIMARIO (PPT) → FALLBACK (pokemontcg.io). Se filtran los ausentes.
    this.freshProviders = ([pptBulk, tcgIo] as (FreshCardPriceProvider | undefined)[]).filter(
      (p): p is FreshCardPriceProvider => p != null,
    );
  }

  /** v1.26 (P-7 ⑤) — cadena de fetch fresco (PPT primario → pokemontcg.io fallback). */
  private readonly freshProviders: FreshCardPriceProvider[];

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
   * v1.x-fx-live (FX AL VUELO, money-safe) — Snapshot de FX vigente para recalcular referencias de
   * MERCADO en USD al momento de VALUAR (no al sincronizar). Devuelve `null` si `FxService` falla o
   * no da una tasa válida (> 0); en ese caso la valuación cae al `priceMxnCents` almacenado (último
   * válido) — NUNCA se rompe la valuación ni se anula una referencia por un fallo de FX.
   */
  async fxSnapshotSafe(): Promise<{ rate: number; bufferPct: number } | null> {
    try {
      const fx = await this.fx.getCurrent();
      if (fx && Number.isFinite(fx.rate) && fx.rate > 0) {
        return { rate: fx.rate, bufferPct: fx.bufferPct };
      }
    } catch (e) {
      this.logger.warn(
        `FX getCurrent falló al valuar; se usa priceMxnCents congelado (último válido): ${(e as Error).message}`,
      );
    }
    return null;
  }

  /**
   * v1.x-fx-live — Convierte UNA fila `PriceReference` al MXN VIGENTE.
   *
   * Regla de distinción "referencia de mercado viva" vs "precio histórico/aceptado":
   *  - `priceUsdCents != null` y NO es override manual → REFERENCIA DE MERCADO en USD: se recalcula
   *    con la FX vigente (`fx`) → cambiar `fx_manual_override_rate`/Banxico mueve el precio AL
   *    INSTANTE, sin re-sync. El `priceMxnCents` almacenado queda solo como fallback money-safe.
   *  - `isManualOverride=true` (override del admin en MXN, `priceUsdCents=null`) → CONGELADO (el admin
   *    fijó pesos a mano; no se toca).
   *  - `priceUsdCents=null` sin override (proveedor nativo en MXN) → CONGELADO (no hay FX que aplicar).
   *
   * Money-safe: si `fx` es `null` (fallo de FX) o el recomputo no resulta finito y > 0, cae al
   * `priceMxnCents` almacenado (invariante `market > 0`; nunca se anula la referencia).
   */
  liveMxnCents(
    ref: { priceMxnCents: number; priceUsdCents: number | null; isManualOverride: boolean },
    fx: { rate: number; bufferPct: number } | null,
  ): number {
    if (fx == null || ref.priceUsdCents == null || ref.isManualOverride) return ref.priceMxnCents;
    const live = usdToMxnCents(ref.priceUsdCents, fx.rate, fx.bufferPct);
    return Number.isFinite(live) && live > 0 ? live : ref.priceMxnCents;
  }

  /**
   * Lee la referencia vigente más reciente (sin filtro de fecha, `capturedDate desc`) para una
   * carta/tipo/grado/ACABADO, en paridad con la valuación del cliente (HoldingDTO).
   * v1.6-finish: `finish` es una columna ortogonal a `gradeKey` (default `normal` para
   * graded/sealed y compatibilidad). Cada acabado tiene su propia PriceReference.
   *
   * v1.x-fx-live: si la referencia es de MERCADO en USD, `referenceMxnCents` se RECALCULA con la FX
   * vigente (`liveMxnCents`), no con el `priceMxnCents` congelado en la ingesta.
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
    const fx = await this.fxSnapshotSafe();
    return {
      status: 'priced',
      referenceMxnCents: this.liveMxnCents(ref, fx),
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
        // v1.x-fx-live: necesarios para recalcular el MXN vigente de referencias de mercado en USD.
        priceUsdCents: true,
        isManualOverride: true,
        source: true,
        capturedDate: true,
      },
    });
    // v1.x-fx-live: FX izada UNA vez por request (no por ítem) para el recomputo al vuelo.
    const fx = await this.fxSnapshotSafe();
    for (const r of rows) {
      const k = keyOf(r);
      if (!wanted.has(k) || map.has(k)) continue; // primera vista = más reciente (orden desc)
      map.set(k, {
        status: 'priced',
        referenceMxnCents: this.liveMxnCents(r, fx),
        source: r.source as PriceSourceStr,
        capturedDate: r.capturedDate.toISOString().slice(0, 10),
      });
    }
    return map;
  }

  /**
   * v1.22-2 / N-15 (ARCHITECTURE §4.22a-6) — `hasPricedRef` EN LOTE (sin N+1). Para un conjunto de
   * cartas, devuelve `Map<cardId, Set<Finish>>` con los acabados que TIENEN una `PriceReference`
   * vigente RAW `raw:NM` con `priceMxnCents > 0` — el MISMO por-acabado que alimenta
   * `referenceValue`/quote. Es la entrada `pricedFinishes` de `computeDisplayFinishes`.
   *
   * UNA sola query (`WHERE cardId IN (...)` + `productType='raw'` + `gradeKey='raw:NM'` +
   * `priceMxnCents > 0`, `distinct [cardId, finish]`), en vez de un `getReference` por (carta,acabado).
   * No aplica FX: solo interesa la EXISTENCIA de precio > 0 (display), no el monto valuado; la
   * invariante de ingesta es `market > 0`, así que el `priceMxnCents` persistido ya lo refleja.
   */
  async getPricedRawFinishesBatch(cardIds: string[]): Promise<Map<string, Set<Finish>>> {
    const map = new Map<string, Set<Finish>>();
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return map;
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardId: { in: ids },
        productType: 'raw',
        gradeKey: 'raw:NM',
        priceMxnCents: { gt: 0 },
      },
      select: { cardId: true, finish: true },
      distinct: ['cardId', 'finish'],
    });
    for (const r of rows) {
      let s = map.get(r.cardId);
      if (!s) {
        s = new Set<Finish>();
        map.set(r.cardId, s);
      }
      s.add(r.finish);
    }
    return map;
  }

  /**
   * v1.28 (P-18/M-30, ARCHITECTURE §4.26b) — controles por variante (`VariantPriceOverride`) EN
   * LOTE: UNA query por request (patrón `getReferencesBatch`, sin N+1). Devuelve
   * `Map<'cardId|productType|gradeKey|finish', VariantPriceOverride>`; clave ausente = SIN fila =
   * comportamiento actual (cadena de reglas). La clave espeja la única de la tabla (M-30).
   * Consumidores: buylist (quote/batch/createRequest), catálogo `fetchSellable`, bulk-publish,
   * binder (`pricing?`/buyable) y la propia consola `variant-controls`.
   */
  async getVariantOverridesBatch(
    items: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[],
  ): Promise<Map<string, VariantPriceOverride>> {
    const map = new Map<string, VariantPriceOverride>();
    if (items.length === 0) return map;
    const keyOf = (i: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }) =>
      `${i.cardId}|${i.productType}|${i.gradeKey}|${i.finish}`;
    const wanted = new Set(items.map(keyOf));
    const rows = await this.prisma.variantPriceOverride.findMany({
      where: {
        cardId: { in: [...new Set(items.map((i) => i.cardId))] },
        productType: { in: [...new Set(items.map((i) => i.productType))] },
        gradeKey: { in: [...new Set(items.map((i) => i.gradeKey))] },
        finish: { in: [...new Set(items.map((i) => i.finish))] },
      },
    });
    for (const r of rows) {
      const k = keyOf(r);
      if (wanted.has(k)) map.set(k, r); // fila única por clave (unique M-30): sin dedupe adicional
    }
    return map;
  }

  /**
   * v1.28 (P-18) — control por variante de UN item (uso single; los flujos de lote usan
   * `getVariantOverridesBatch`). `null` = sin fila (cadena de reglas de siempre).
   */
  async getVariantOverride(
    cardId: string,
    productType: ProductType,
    gradeKey: string,
    finish: Finish,
  ): Promise<VariantPriceOverride | null> {
    const map = await this.getVariantOverridesBatch([{ cardId, productType, gradeKey, finish }]);
    return map.get(`${cardId}|${productType}|${gradeKey}|${finish}`) ?? null;
  }

  /**
   * v1.28 (P-18) — iza `BUYLIST_PRICE_RULES` + fallback UNA vez por request (espejo de
   * `loadSalesRules`), para consola/binder. OJO: `BuylistService.buylistRules()` NO delega aquí —
   * son DOS lecturas paralelas de la MISMA config (mismas SettingKey, misma forma; decisión
   * justificada para no acoplar módulos, registrada como deuda SB-D2). El cuerpo normativo de la
   * semántica de precio es la matemática compartida en `money.ts`; si cambia el formato del dial,
   * ambos reads cambian juntos.
   */
  async loadBuylistRules(): Promise<{ rules: Record<string, BuylistRule>; fallbackPct: number }> {
    const rules =
      ((await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES)) as Record<string, BuylistRule> | null) ??
      {};
    const fallbackPct = await this.settings.getNumber(SettingKey.BUYLIST_PRICE_FALLBACK_PCT);
    return { rules, fallbackPct };
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
   * v1.23-sealed-sales (§4.23b/§4.23c/§4.23d) — CONTEXTO de precio del SELLADO izado en UNA lectura
   * por request (espejo de `loadSalesRules`, pago mínimo de BE-25): spreads por presentación +
   * fallback + estado del dial `sealedPriceSource`. `sourceOn=false` (dial off) ⇒ el sellado solo se
   * vende con override manual (el `sealedMarketRef` queda inerte, ARCHITECTURE §4.23a).
   */
  async loadSealedSpreads(): Promise<{
    spreadPctBySubtype: Record<string, number>;
    fallbackPct: number;
    sourceOn: boolean;
  }> {
    const spreadPctBySubtype =
      ((await this.settings.getRaw(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE)) as Record<
        string,
        number
      > | null) ?? {};
    const fallbackPct = await this.settings.getNumber(SettingKey.SEALED_SPREAD_FALLBACK_PCT);
    const sourceOn = (await this.settings.getString(SettingKey.SEALED_PRICE_SOURCE)) === 'tcgcsv';
    return { spreadPctBySubtype, fallbackPct, sourceOn };
  }

  /**
   * gradeKey de la referencia de MERCADO del sellado de UN item (`sealed:tcg:<productId>`), o `null`
   * si el item no está mapeado (sin productId → sin mercado). Lo usan los call-sites que batchean
   * referencias de sellado (grid, bulk-publish, bóveda sellada) para no reinventar la clave.
   */
  sealedMarketGradeKeyForItem(item: { tcgplayerProductId: number | null }): string | null {
    return item.tcgplayerProductId != null ? sealedMarketGradeKey(item.tcgplayerProductId) : null;
  }

  /**
   * v1.23-sealed-sales (§4.23d) — resuelve el `sealedMarketRef` (referencia de mercado TCGCSV) de un
   * item sellado: `PriceReference(cardId, 'sealed', 'sealed:tcg:<productId>', 'normal')`. `null` si no
   * mapeado. Uso SINGLE (los batch usan `getReferencesBatch` con `sealedMarketGradeKeyForItem`).
   */
  async getSealedMarketRef(item: {
    cardId: string;
    tcgplayerProductId: number | null;
  }): Promise<PriceInfo> {
    const gradeKey = this.sealedMarketGradeKeyForItem(item);
    if (gradeKey == null) return { status: 'pending' };
    return this.getReference(item.cardId, 'sealed', gradeKey, 'normal');
  }

  /**
   * v1.24-sealed-dedup (H-1) — GATE money-safe del MERCADO del sellado: UNA sola fuente de verdad
   * para «¿cuánto mercado cuenta?». El `sealedMarketRef` (TCGCSV) solo aporta con el dial ENCENDIDO
   * (`sourceOn`) y con una fila `priced` (referenceMxnCents no-null). Con el dial `off` el mercado
   * queda INERTE (§4.23a) y devuelve `null`. Antes este predicado estaba copiado en catálogo, Compra,
   * grid, bulk-publish y valuación (H-1: 4-5 copias divergentes).
   */
  gateSealedMarketCents(ref: PriceInfo | undefined | null, sourceOn: boolean): number | null {
    return sourceOn && ref?.status === 'priced' && ref.referenceMxnCents != null
      ? ref.referenceMxnCents
      : null;
  }

  /**
   * v1.24-sealed-dedup (H-1) — RESOLVER ÚNICO del precio de VENTA del sellado. Encapsula el gate del
   * mercado (`gateSealedMarketCents`) + la pura `computeSealedSalePrice` (precedencia override>0 >
   * mercado×spread(subtype) > mercado×spread(global) > PRICE_PENDING). Devuelve el `SealedSpreadResult`
   * completo (`{ salePriceCents, source, status, appliedSpreadPct }`).
   *
   * Consumidores: catálogo (`toListingDTO`), Compra (`orders.salePriceOf`), grid (`loadPricedSealed`) y
   * bulk-publish (`inventory`). Un solo cuerpo ⇒ los cuatro coinciden SIEMPRE (incluida la regla de
   * override=0). SEC-A1: `listPriceCents`/`sealedSubtype`/`ref` salen de BD, los spreads de
   * ConfigSetting (vía `ctx`, izado una vez por request con `loadSealedSpreads`); nada del DTO del cliente.
   */
  resolveSealedSalePrice(
    item: { listPriceCents: number | null; sealedSubtype: string | null },
    ref: PriceInfo | undefined | null,
    ctx: { spreadPctBySubtype: Record<string, number>; fallbackPct: number; sourceOn: boolean },
  ): SealedSpreadResult {
    const marketCents = this.gateSealedMarketCents(ref, ctx.sourceOn);
    return computeSealedSalePrice(
      item.listPriceCents,
      item.sealedSubtype,
      marketCents,
      ctx.spreadPctBySubtype,
      ctx.fallbackPct,
    );
  }

  /**
   * v1.23-sealed-sales (§4.23d) — precio de VENTA del sellado por presentación (SEC-A1). Lee el
   * contexto de spreads e invoca la pura `computeSealedSalePrice`. `marketMxnCents` = el
   * `sealedMarketRef` YA gateado por el dial (el llamador pasa `null` si `sourceOn=false`).
   */
  async computeSealedSalePriceForItem(
    item: { listPriceCents: number | null; sealedSubtype: string | null },
    marketMxnCents: number | null,
  ): Promise<SealedSpreadResult> {
    const { spreadPctBySubtype, fallbackPct } = await this.loadSealedSpreads();
    return computeSealedSalePrice(
      item.listPriceCents,
      item.sealedSubtype,
      marketMxnCents,
      spreadPctBySubtype,
      fallbackPct,
    );
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
  ): Promise<string> {
    // v1.26 (④): devuelve el id de la entrada open (creada o preexistente) para que el llamador
    // (bulkPublish) pueble `pendingPriceEntryId` en la línea PRICE_PENDING (deep-link de UI a M2).
    // Sigue siendo idempotente: dedupe por `(cardId, productType, gradeKey, finish, status='open')`.
    const open = await this.prisma.pendingPriceEntry.findFirst({
      where: { cardId, productType, gradeKey, finish, status: 'open' },
    });
    if (open) return open.id;
    const created = await this.prisma.pendingPriceEntry.create({
      data: { cardId, productType, gradeKey, finish, context, refId, status: 'open' },
    });
    return created.id;
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

  /**
   * v1.26 (P-7 ⑤, ARCHITECTURE §4.24e) — REPRECIO FRESCO on-demand de un puñado de cartas. Orquesta
   * el fetch FRESCO puntual (proveedor PRIMARIO PPT por `tcgplayerId` → FALLBACK pokemontcg.io por
   * `externalId`) + el upsert de `PriceReference` (vía `persistMarketReference`, FX del día). Lo usa
   * `bulkPublish({repriceFresh})` ANTES de resolver el precio, para publicar con una referencia
   * RECIÉN traída (no la almacenada stale).
   *
   * CUOTA (money-safe): CAPA a `MAX_FRESH_REPRICE_CARDS` (nunca barre) y respeta el `dailyLimited`
   * del proveedor de PAGA (para de pedirle; el fallback igual intenta). FALLA-SEGURO: un error de
   * proveedor/FX NUNCA propaga ni inventa un precio — la carta se queda `pending` y el llamador cae a
   * la referencia ALMACENADA (o escala). Solo se persiste una fila con `market > 0`.
   *
   * @param cardIds cartas a repreciar (se deduplican y capan).
   * @param finishes acabados a refrescar; si se omite, se usan los `availableFinishes` de cada carta.
   * @returns `{ refreshed, pending, dailyLimited }` — refreshed = cartas con ≥1 referencia nueva.
   */
  async refreshCardPrices(cardIds: string[], finishes?: Finish[]): Promise<RefreshCardPricesResult> {
    const uniqueIds = [...new Set(cardIds)];
    const capped = uniqueIds.slice(0, MAX_FRESH_REPRICE_CARDS);
    if (capped.length === 0) return { refreshed: [], pending: [], dailyLimited: false };

    const cards = await this.prisma.card.findMany({
      where: { id: { in: capped } },
      select: { id: true, externalId: true, tcgplayerId: true, availableFinishes: true },
    });

    const wantForCard = (avail: Finish[] | null | undefined): Finish[] => {
      if (finishes && finishes.length > 0) return [...new Set(finishes)];
      const a = (avail ?? []) as Finish[];
      return a.length > 0 ? a : ['normal'];
    };
    const refs: FreshCardRef[] = cards.map((c) => ({
      cardId: c.id,
      tcgplayerId: c.tcgplayerId,
      externalId: c.externalId,
      finishes: wantForCard(c.availableFinishes as Finish[]),
    }));

    // FX del día izado UNA vez (money-safe: si falla, solo se persisten filas MXN; las USD se omiten).
    let fx: { rate: number; bufferPct: number } | null = null;
    try {
      const cur = await this.fx.getCurrent();
      if (Number.isFinite(cur.rate) && cur.rate > 0) fx = { rate: cur.rate, bufferPct: cur.bufferPct };
    } catch (e) {
      this.logger.warn(`refreshCardPrices: FX getCurrent falló → solo se persisten filas MXN. ${(e as Error).message}`);
    }

    const refreshed = new Set<string>();
    let dailyLimited = false;
    // Cartas aún sin referencia fresca (para intentarlas con el siguiente proveedor de la cadena).
    let pendingRefs = refs;

    for (const provider of this.freshProviders) {
      if (pendingRefs.length === 0) break;
      let result;
      try {
        result = await provider.fetchFreshForCards(pendingRefs);
      } catch (e) {
        // Un proveedor que revienta NO tumba el reprecio (money-safe): se intenta el siguiente.
        this.logger.warn(`refreshCardPrices: proveedor ${provider.source} falló: ${(e as Error).message}`);
        continue;
      }
      if (result.dailyLimited) dailyLimited = true;
      for (const row of result.rows) {
        if (!(row.marketCents > 0)) continue; // money-safe: nunca 0/negativo.
        if (row.currency === 'USD' && fx == null) continue; // sin FX no se inventa el MXN.
        try {
          await this.persistMarketReference(
            row.cardId,
            row.finish,
            { marketCents: row.marketCents, currency: row.currency, source: row.source },
            fx ?? { rate: 0, bufferPct: 0 }, // fx NO se usa para currency MXN.
          );
          refreshed.add(row.cardId);
        } catch (e) {
          this.logger.warn(`refreshCardPrices: upsert falló para ${row.cardId}/${row.finish}: ${(e as Error).message}`);
        }
      }
      // Solo se reintentan en el fallback las cartas que NO obtuvieron ninguna referencia fresca.
      pendingRefs = pendingRefs.filter((r) => !refreshed.has(r.cardId));
    }

    return {
      refreshed: [...refreshed],
      pending: capped.filter((id) => !refreshed.has(id)),
      dailyLimited,
    };
  }

  /**
   * v1.19-sealed-tcgcsv (§4.19d) — HERMANO de `persistMarketReference` para la referencia de
   * mercado del SELLADO. MISMA doctrina money-safe (upsert idempotente por día, NO clobbea el
   * override manual, NO escala pendientes), con la clave del sellado de mercado:
   * `(cardId=anchorCardId, productType='sealed', gradeKey=sealed:tcg:<productId>, finish='normal',
   * capturedDate=hoy)`, `source='tcgcsv'`.
   *
   * - TCGCSV publica SIEMPRE USD → conversión `usdToMxnCents(market, fx.rate, fx.bufferPct)`
   *   (colchón #13 aplica en cada corrida); se guarda la trazabilidad (`priceUsdCents`, `fxRate`,
   *   `fxBufferPct`).
   * - El gradeKey legacy `'sealed'` (override manual / costo de aportación) NO se toca: dos
   *   productos sellados distintos anclados a la misma Card conviven vía `sealed:tcg:<productId>`.
   * - Esta referencia es INFORMATIVA: no fija `listPriceCents`, no publica, no encola
   *   `PendingPriceEntry` (doctrina §4.19a).
   */
  async persistSealedMarketReference(
    anchorCardId: string,
    tcgplayerProductId: number,
    market: { marketCents: number },
    fx: { rate: number; bufferPct: number },
  ): Promise<void> {
    const productType: ProductType = 'sealed';
    const gradeKey = sealedMarketGradeKey(tcgplayerProductId);
    const finish: Finish = 'normal';
    const capturedDate = today();
    const key = {
      cardId_productType_gradeKey_finish_capturedDate: {
        cardId: anchorCardId,
        productType,
        gradeKey,
        finish,
        capturedDate,
      },
    };
    const existing = await this.prisma.priceReference.findUnique({ where: key });
    // No clobbea el override manual del admin (paridad con persistMarketReference, §4.1).
    if (existing?.isManualOverride) return;
    const priceMxnCents = usdToMxnCents(market.marketCents, fx.rate, fx.bufferPct);
    const data = {
      source: 'tcgcsv' as PriceSourceStr,
      priceUsdCents: market.marketCents,
      fxRate: fx.rate,
      fxBufferPct: fx.bufferPct,
      priceMxnCents,
      isManualOverride: false,
    };
    await this.prisma.priceReference.upsert({
      where: key,
      create: { cardId: anchorCardId, productType, gradeKey, finish, capturedDate, ...data },
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
  async pendingQueue(context?: 'catalog' | 'portfolio' | 'buylist' | 'inventory') {
    // P-6 (§M2): filtro opcional por `context` para los dos buckets de M2 (VENTA=`inventory`,
    // COMPRA=`buylist` read-only). Sin arg → todos los pendientes (back-compat). Shape sin cambios.
    const rows = await this.prisma.pendingPriceEntry.findMany({
      where: { status: 'open', ...(context ? { context } : {}) },
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
   * - v1.28 (P-18, §4.26b): `controls` opcional = fila M-30 de la variante (sellOverride pisa la
   *   regla; omitido/null = comportamiento actual). El paso 1 (`listPriceCents` por pieza) lo
   *   aplican los callers ANTES, como siempre.
   */
  async computeSalePriceForItem(
    item: { rarity: string | null; finish: Finish },
    referenceMxnCents: number | null,
    controls?: VariantPriceControls | null,
  ): Promise<SalePriceResult> {
    const { rules, fallbackPct } = await this.loadSalesRules();
    return computeSalePriceForRarity(item.rarity, item.finish, referenceMxnCents, rules, fallbackPct, controls);
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

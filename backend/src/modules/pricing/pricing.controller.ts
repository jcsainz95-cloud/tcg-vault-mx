import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Finish, PendingPriceContext, Prisma, ProductType, Role } from '@prisma/client';
import { Allow, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from './pricing.service';
import { FxService } from './fx.service';
import { SettingsService } from '../settings/settings.service';
import {
  SettingKey,
  validateFallbackPct,
  validateSalesFallbackPct,
  validateSealedSpreads,
  validateSealedSpreadFallback,
  validateFxManualOverrideRate,
  validateTieredRuleSet,
  isValidBuylistRule,
  isValidSalesRule,
} from '../settings/settings.constants';
import { BuylistRule, SalesRule, PriceRuleSet, toPriceRuleSet } from '../../common/money';
import {
  PRICING_TIERS,
  TIER_IDS,
  TierId,
  isTierId,
  getTier,
} from '../../common/pricing-tiers';
import {
  rarityInfo,
  isPremiumCanonicalRarity,
  isRarityMapped,
  normalizeRarity,
} from '../../common/rarity-catalog';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceSyncJobService } from '../../jobs/price-sync.service';
// N-11: estado en memoria del barrido masivo de precios (barra de progreso del sync).
import { PriceIngestService } from './price-ingest.service';
// v1.28 (P-18/P-22): consola de precios por variante (M-30) — validación/upsert/auditoría.
import { VariantControlsService } from './variant-controls.service';

/** P-6 (§M2): valores válidos del query `?context=` de `GET /admin/pricing/pending`. */
const VALID_PENDING_CONTEXTS: readonly PendingPriceContext[] = Object.values(PendingPriceContext);

class OverrideDto {
  @IsString() cardId!: string;
  @IsString() productType!: ProductType;
  @IsString() gradeKey!: string;
  // SEGURIDAD L1 (dinero): rechaza 0 centavos. Un $0 de override/referencia de mercado NO debe ser
  // fijable — P-6 enruta al operador a override-and-publish, de modo que un 0 nunca es un precio legítimo.
  @IsInt() @Min(1) priceMxnCents!: number;
  // v1.6-finish: override por acabado (default normal). Cada acabado tiene su PriceReference.
  @IsOptional() @IsIn(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'])
  finish?: Finish;
}

/**
 * v1.14-price-ingest (#13): `rate?` opcional. Si se omite, se actualiza SOLO el colchón
 * (`bufferPct`) sin pinnear el override manual de tasa (Banxico auto sigue activo). Ambos son
 * opcionales pero el controller exige al menos uno (422 si el body no trae ninguno).
 */
class FxDto {
  // FX-B2: fraccional permitido (FxRate es Decimal(12,6)); el rango [min, MAX] lo aplica el
  // validador compartido `validateFxManualOverrideRate` en setManual(), MISMA regla que
  // PUT /admin/settings. Aquí solo se exige que sea número finito (rechaza strings/NaN).
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsInt() @Min(0) bufferPct?: number;
}

/**
 * v1.37 (§4.33, P-34) — body de `PUT /admin/pricing/tiers`. `@Allow()` (whitelist sin validar aquí): la
 * validación es MANUAL en `putTiers` porque distingue la forma anidada (tiers[], finishRules{buy,sell},
 * fallbackPct{buy,sell}), exige las 5 filas y emite códigos propios (VALIDATION_ERROR /
 * PREMIUM_RARITY_FIXED_TIER) que los decoradores de class-validator no expresan.
 */
class TiersPutDto {
  @Allow() tiers?: unknown;
  @Allow() finishRules?: unknown;
  @Allow() fallbackPct?: unknown;
}

/** v1.37 (§4.33d) — body de `PUT /admin/pricing/tier-map`. Validación manual en `putTierMap`. */
class TierMapPutDto {
  @Allow() assignments?: unknown;
}

/**
 * v1.23-sealed-sales (§M2): spreads de venta del SELLADO por presentación (+ fallback global).
 * PARCIAL: solo las claves a cambiar. `pct` = markup ARRIBA de mercado, número en [0,1000].
 */
class SealedSpreadsDto {
  @IsOptional() @IsObject() spreadPctBySubtype?: Record<string, number>;
  @IsOptional() @IsNumber() fallbackPct?: number;
}

class SyncDto {
  @IsOptional() @IsString() scope?: 'all_vault' | 'cardIds';
  @IsOptional() cardIds?: string[];
}

/**
 * v1.28 (P-18/P-22, §M2) — body de PUT /admin/pricing/variant-controls/:cardId/:finish.
 * `@Allow()` (whitelist sin validar aquí): la validación es MANUAL en `VariantControlsService`
 * porque el contrato distingue OMITIDO (no tocar) de `null` (limpiar) — semántica que los
 * decoradores de class-validator no expresan — y los errores deben salir 422 con códigos propios
 * (VALIDATION_ERROR / FINISH_NOT_AVAILABLE / BOUNTY_PRICE_REQUIRED / BOUNTY_BELOW_RULE).
 */
class VariantControlsDto {
  @Allow() productType?: unknown;
  @Allow() gradeKey?: unknown;
  @Allow() sellOverrideCents?: unknown;
  @Allow() buyOverrideCents?: unknown;
  @Allow() bounty?: unknown;
}

/**
 * M2 — Catálogo y precios (super_admin). API_CONTRACT §M2.
 */
@Controller('admin/pricing')
@Roles(Role.super_admin)
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly priceSync: PriceSyncJobService,
    private readonly priceIngest: PriceIngestService,
    private readonly variantControls: VariantControlsService,
  ) {}

  /**
   * @deprecated (v1.30) — «sync de precios (bóveda)» del UI M2. El front lo retira. NO se borra
   * todavía porque `PriceSyncJobService.run()` sigue siendo el ejecutable del job PROGRAMADO
   * `price-sync` (BullMQ, cron `15 6 * * *`, ver `scheduler.service.ts`), que SÍ depende del servicio.
   * Solo el DISPARO MANUAL por este endpoint (`.enqueue`) queda deprecado; retirarlo definitivamente es
   * follow-up del arquitecto una vez confirmado que ningún cliente lo llama. Ver docs/BACKEND_NOTES.md.
   */
  @Post('sync')
  async sync(@Body() dto: SyncDto, @CurrentUser('id') userId: string) {
    const result = await this.priceSync.enqueue(dto.scope ?? 'all_vault', dto.cardIds);
    await this.audit.log({ actorUserId: userId, action: 'pricing.sync', entityType: 'PriceReference' });
    return result;
  }

  /**
   * N-11 — GET /admin/pricing/sync-status: progreso del barrido MASIVO de precios (`price-ingest`)
   * en curso o del último. Calca `GET /admin/catalog/sync-status`. En memoria del proceso, NO llama
   * al proveedor en cada poll. El front lo pollea ~3s mientras `running` y pinta la barra done/total;
   * `dailyLimited` señala "pausado por límite del día (retoma 00:00 UTC), N pendientes".
   */
  @Get('sync-status')
  getSyncStatus() {
    return this.priceIngest.getSyncStatus();
  }

  /**
   * P-6 (§M2): dos buckets. Query param opcional `?context=` — **VENTA** = `context=inventory`;
   * **COMPRA** = vista READ-ONLY sobre `context=buylist`. Sin `context` → todos (back-compat).
   * Validación estricta: un valor fuera del enum `PendingPriceContext` → 422 VALIDATION_ERROR
   * (mismo estilo que el resto del controller). Producir el precio de COMPRA es WRITE del stream
   * buylist (`itemDecision`) — FUERA DE ALCANCE aquí; este endpoint es solo lectura.
   */
  @Get('pending')
  pending(@Query('context') context?: string) {
    if (context !== undefined && !VALID_PENDING_CONTEXTS.includes(context as PendingPriceContext)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        `invalid context '${context}'`,
        { field: 'context', allowed: VALID_PENDING_CONTEXTS },
      );
    }
    return this.pricing.pendingQueue(context as PendingPriceContext | undefined);
  }

  @Post('override')
  async override(@Body() dto: OverrideDto, @CurrentUser('id') userId: string) {
    const ref = await this.pricing.manualOverride(
      dto.cardId,
      dto.productType,
      dto.gradeKey,
      dto.priceMxnCents,
      dto.finish ?? 'normal',
    );
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.override',
      entityType: 'PriceReference',
      entityId: ref.id,
      after: { priceMxnCents: dto.priceMxnCents, finish: dto.finish ?? 'normal' },
    });
    return ref;
  }

  /**
   * v1.28 (P-18/P-22, §M2 / ARCHITECTURE §4.26a-b) — upsert de los CONTROLES de precio por
   * (carta, variante[, grado]): override de VENTA (pisa el storefront), override de COMPRA (pisa el
   * cotizador público) y bounty (P-22). `super_admin` (hereda el @Roles del controller: precios =
   * M2, §7) y AUDITADO (before/after) dentro del servicio. Campo omitido no se toca; `null` limpia.
   * NO toca PriceReference ni resuelve PendingPriceEntry (el mercado es otra perilla).
   */
  @Put('variant-controls/:cardId/:finish')
  putVariantControls(
    @Param('cardId') cardId: string,
    @Param('finish') finish: string,
    @Body() dto: VariantControlsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.variantControls.update(cardId, finish, dto, userId);
  }

  @Get('card/:cardId')
  history(@Param('cardId') cardId: string) {
    return this.pricing.priceHistory(cardId);
  }

  // ---------------- Precio de buylist por RAREZA (v1.3.1, §E.1) ----------------

  /**
   * v1.29 (§4.28d) — Lee el `PriceRuleSet` de DOS EJES + fallback (migra el legacy plano on-read).
   * `rarityRules` se keyea por rareza canónica; `finishRules` por el enum Finish. API_CONTRACT §M2.
   */
  private async readBuylistRuleSet(): Promise<PriceRuleSet<BuylistRule>> {
    const fallbackPct = await this.settings.getNumber(SettingKey.BUYLIST_PRICE_FALLBACK_PCT);
    // v1.37 (§4.33c): DERIVA el `PriceRuleSet` efectivo desde (tierRules × PRICING_TIER_MAP) si el
    // setting trae el shape por tiers; compat on-read con `{ rarityRules, ... }`/plano (§4.28d).
    return toPriceRuleSet<BuylistRule>(
      await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES),
      fallbackPct,
      await this.readTierMap(),
    );
  }

  /**
   * v1.37 (§4.33b/c) — lee el mapa COMPARTIDO `PRICING_TIER_MAP` (`Record<canonicalRarity, TierId>`).
   * Forma degenerada del setting ⇒ `{}` (money-safe: todo cae al fallback, nunca $0).
   */
  private async readTierMap(): Promise<Record<string, TierId>> {
    const raw = await this.settings.getRaw(SettingKey.PRICING_TIER_MAP);
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, TierId>;
  }

  /**
   * v1.37 (§4.33c) — GET del `PriceRuleSet` EFECTIVO de compra (derivado de tiers×mapa). SUPERSEDED por
   * `/tiers`+`/tier-map` como editor; se conserva como lectura durante la transición. El PUT se RETIRÓ.
   */
  @Get('buylist-rules')
  async getBuylistRules() {
    return this.readBuylistRuleSet();
  }

  // v1.37 (§4.33 / API_CONTRACT §M2): `PUT /admin/pricing/buylist-rules` RETIRADO (superseded). El eje
  // rareza ya no se edita por rareza suelta sino por TIER: usa `PUT /admin/pricing/tiers` (valores de las 5
  // reglas + eje acabado + fallbacks) y `PUT /admin/pricing/tier-map` (asignación rareza→tier).

  /**
   * v1.29 (§4.28c) — Rarezas CANÓNICAS del catálogo (`groupBy(['rarityCanonical'])`) unidas a sus
   * reglas de rareza (para poblar el editor M2). Cada entrada: `canonical` (key editable), `raw` (una
   * forma cruda observada), `premium` (del catálogo canónico), `mapped` (false = unmapped → fallback),
   * `cardCount`, `rule`, `source`. `rarity` = alias DEPRECADO de `canonical`. Ordenado por cardCount desc.
   */
  @Get('rarities')
  async rarities() {
    const ruleSet = await this.readBuylistRuleSet();
    return this.buildRaritiesResponse(ruleSet, await this.readTierMap());
  }

  /**
   * Construye la respuesta de `rarities`/`sales-rarities`: agrupa por `rarityCanonical`, junta una
   * forma cruda representativa (para diagnóstico) y resuelve la regla de RAREZA (`rarityRules`).
   * v1.37 (§4.33c): cada entrada gana `tierId` (del mapa vigente) + `source:'map'|'fallback'`; el `rule`
   * refleja la regla RESUELTA vía tier (el `ruleSet` ya es el efectivo derivado de tiers×mapa).
   */
  private async buildRaritiesResponse(
    ruleSet: PriceRuleSet<BuylistRule | SalesRule>,
    tierMap: Record<string, TierId>,
  ) {
    // Agrupa por la CANÓNICA (§4.28c: empate 1:1 con las keys del admin) + una forma cruda por canónica.
    const grouped = await this.prisma.card.groupBy({
      by: ['rarityCanonical', 'rarity'],
      _count: { _all: true },
    });
    const byCanonical = new Map<
      string,
      { canonical: string; raw: string | null; cardCount: number }
    >();
    for (const g of grouped) {
      const canonical = g.rarityCanonical;
      if (canonical == null) continue;
      const acc = byCanonical.get(canonical) ?? { canonical, raw: g.rarity ?? null, cardCount: 0 };
      acc.cardCount += g._count._all;
      if (acc.raw == null && g.rarity != null) acc.raw = g.rarity;
      byCanonical.set(canonical, acc);
    }
    const rarities = [...byCanonical.values()]
      .map((r) => {
        const explicit = ruleSet.rarityRules[r.canonical];
        const info = rarityInfo(r.canonical);
        const tierId = tierMap[r.canonical] ?? null;
        return {
          canonical: r.canonical,
          // `rarity` conservado como ALIAS de `canonical` (compat, DEPRECADO).
          rarity: r.canonical,
          raw: r.raw,
          premium: info.premium,
          mapped: info.mapped,
          cardCount: r.cardCount,
          // v1.37: `rule` = regla RESUELTA vía tier (o fallback pct si la rareza no está en el mapa).
          rule: explicit ?? { mode: 'pct' as const, value: ruleSet.fallbackPct },
          tierId,
          // 'map' = la rareza hereda la regla de su tier (está en PRICING_TIER_MAP); 'fallback' = sin tier.
          source: tierId != null ? ('map' as const) : ('fallback' as const),
        };
      })
      .sort((a, b) => b.cardCount - a.cardCount);
    return { fallbackPct: ruleSet.fallbackPct, rarities };
  }

  // ---------------- Precio de VENTA por RAREZA (v1.13-sales-pricing, §4.14c) ----------------
  // Clones 1:1 del patrón buylist de arriba. Auditados (super_admin). API_CONTRACT §M2.
  // OJO semántica: en venta `pct` = markup ARRIBA de mercado (no % de la referencia como en buylist);
  // la matemática vive en money.computeSalePriceForRarity — aquí solo se lee/escribe la tabla cruda.

  /**
   * v1.37 (§4.33c) — Lee el `PriceRuleSet` EFECTIVO de VENTA (derivado de tiers×mapa; compat on-read con
   * `{ rarityRules, ... }`/plano). API_CONTRACT §M2.
   */
  private async readSalesRuleSet(): Promise<PriceRuleSet<SalesRule>> {
    const fallbackPct = await this.settings.getNumber(SettingKey.SALES_PRICE_FALLBACK_PCT);
    return toPriceRuleSet<SalesRule>(
      await this.settings.getRaw(SettingKey.SALES_PRICE_RULES),
      fallbackPct,
      await this.readTierMap(),
    );
  }

  @Get('sales-rules')
  async getSalesRules() {
    return this.readSalesRuleSet();
  }

  // v1.37 (§4.33 / API_CONTRACT §M2): `PUT /admin/pricing/sales-rules` RETIRADO (superseded por `/tiers`).

  /**
   * Rarezas distintas del catálogo unidas a sus reglas de VENTA (para poblar el editor M2).
   * Devuelve rarezas con regla explícita y rarezas del catálogo aún sin regla (muestran el fallback).
   * Ordenado por cardCount desc. API_CONTRACT §M2.
   */
  @Get('sales-rarities')
  async salesRarities() {
    // v1.29 (§4.28c): eco de ventas — mismo agrupado por `rarityCanonical` que `rarities`.
    const ruleSet = await this.readSalesRuleSet();
    return this.buildRaritiesResponse(ruleSet, await this.readTierMap());
  }

  // ---------------- Pricing por TIERS (v1.37, P-34, §4.33 / API_CONTRACT §M2) ----------------
  // El eje RAREZA se edita por TIER (5 peldaños T0–T4) + un MAPA rareza→tier compartido por compra y
  // venta. La naturaleza de la regla (`fixed`/`pct`), la precedencia y el eje `finish` NO cambian.
  // Todo auditado (super_admin) y surte efecto sin redeploy. Invariante money-safe (§4.33d) en ambos PUT.

  /**
   * Extrae `{ tierRules, finishRules }` del setting crudo. Si trae el shape por tiers (post-M-38) los usa;
   * si es legacy (`{ rarityRules, ... }`/plano, pre-M-38) → `tierRules` vacío (durante la transición el
   * editor mostrará las 5 reglas al fallback) y conserva `finishRules` si venían. Nunca lanza.
   */
  private extractTiered<R extends BuylistRule | SalesRule>(
    raw: unknown,
  ): { tierRules: Partial<Record<TierId, R>>; finishRules: Partial<Record<string, R>> } {
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
      const o = raw as { tierRules?: unknown; finishRules?: unknown };
      const tierRules =
        o.tierRules != null && typeof o.tierRules === 'object' && !Array.isArray(o.tierRules)
          ? (o.tierRules as Partial<Record<TierId, R>>)
          : {};
      const finishRules =
        o.finishRules != null && typeof o.finishRules === 'object' && !Array.isArray(o.finishRules)
          ? (o.finishRules as Partial<Record<string, R>>)
          : {};
      return { tierRules, finishRules };
    }
    return { tierRules: {}, finishRules: {} };
  }

  /**
   * §4.33d — pares `(rareza, tier)` que VIOLARÍAN el invariante money-safe: una rareza `premium:true`
   * (catálogo canónico, §4.28e) mapeada a un tier cuya regla de COMPRA es `fixed`. Una rareza premium
   * jamás debe cotizar al bin fijo barato de bulk, aunque el dueño edite el mapa/las reglas. Un tier SIN
   * regla de compra (undefined) NO es infractor (cae al fallback pct = money-safe). El eje de venta NO
   * entra al invariante (un `fixed` de venta es un piso, §4.33d).
   */
  private premiumFixedOffenders(
    tierMap: Record<string, TierId>,
    buyTierRules: Partial<Record<TierId, BuylistRule>>,
  ): { rarity: string; tierId: TierId }[] {
    const out: { rarity: string; tierId: TierId }[] = [];
    for (const [rarity, tierId] of Object.entries(tierMap)) {
      const rule = isTierId(tierId) ? buyTierRules[tierId] : undefined;
      if (rule?.mode === 'fixed' && isPremiumCanonicalRarity(rarity)) out.push({ rarity, tierId });
    }
    return out;
  }

  /** Construye la respuesta de `GET /admin/pricing/tiers` (mismo shape que devuelve el PUT). */
  private async buildTiersResponse() {
    const buy = this.extractTiered<BuylistRule>(
      await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES),
    );
    const sell = this.extractTiered<SalesRule>(
      await this.settings.getRaw(SettingKey.SALES_PRICE_RULES),
    );
    const buyFallback = await this.settings.getNumber(SettingKey.BUYLIST_PRICE_FALLBACK_PCT);
    const sellFallback = await this.settings.getNumber(SettingKey.SALES_PRICE_FALLBACK_PCT);
    const tierMap = await this.readTierMap();
    const rarityCountByTier = new Map<TierId, number>();
    for (const t of Object.values(tierMap)) {
      if (isTierId(t)) rarityCountByTier.set(t, (rarityCountByTier.get(t) ?? 0) + 1);
    }
    const tiers = TIER_IDS.map((id) => {
      const t = getTier(id)!;
      return {
        id,
        name: t.name,
        premium: t.premium,
        // Regla vigente del tier; si aún no hay (legacy en transición) se muestra el fallback pct.
        buy: buy.tierRules[id] ?? { mode: 'pct' as const, value: buyFallback },
        sell: sell.tierRules[id] ?? { mode: 'pct' as const, value: sellFallback },
        rarityCount: rarityCountByTier.get(id) ?? 0,
      };
    });
    return {
      tiers,
      finishRules: { buy: buy.finishRules, sell: sell.finishRules },
      fallbackPct: { buy: buyFallback, sell: sellFallback },
    };
  }

  /**
   * `GET /admin/pricing/tiers` (v1.37) — lee los 5 tiers (regla de COMPRA y VENTA), el eje acabado y los
   * fallbacks. `id`/`name`/`premium` = taxonomía LOCKED; `rarityCount` = nº de rarezas mapeadas al tier.
   */
  @Get('tiers')
  async getTiers() {
    return this.buildTiersResponse();
  }

  /**
   * `PUT /admin/pricing/tiers` (v1.37, §4.33) — reemplaza los VALORES de las 5 reglas (buy y sell), el eje
   * acabado y los fallbacks. `name`/`premium` se ignoran (taxonomía LOCKED). Deben venir las 5 filas. El
   * invariante money-safe (§4.33d) se valida contra el MAPA vigente ⇒ 422 PREMIUM_RARITY_FIXED_TIER si un
   * tier con compra `fixed` tiene alguna rareza premium mapeada. Auditado. Sin redeploy.
   */
  @Put('tiers')
  async putTiers(@Body() dto: TiersPutDto, @CurrentUser('id') userId: string) {
    if (!Array.isArray(dto.tiers)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'tiers must be an array of 5 rows', {
        field: 'tiers',
      });
    }
    const buyTierRules: Partial<Record<TierId, BuylistRule>> = {};
    const sellTierRules: Partial<Record<TierId, SalesRule>> = {};
    const seen = new Set<TierId>();
    for (const row of dto.tiers as unknown[]) {
      if (row == null || typeof row !== 'object') {
        throw BusinessException.validation('VALIDATION_ERROR', 'each tier row must be an object', {
          field: 'tiers',
        });
      }
      const { id, buy, sell } = row as { id?: unknown; buy?: unknown; sell?: unknown };
      if (!isTierId(id)) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `invalid tier id: must be one of ${TIER_IDS.join('|')}`,
          { field: 'tiers.id' },
        );
      }
      if (!isValidBuylistRule(buy)) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `invalid buy rule for ${id}: fixed→integer cents ≥ 0, pct→number in [0,100]`,
          { field: 'tiers.buy', tierId: id },
        );
      }
      if (!isValidSalesRule(sell)) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `invalid sell rule for ${id}: fixed→integer cents ≥ 0, pct→number in [0,1000]`,
          { field: 'tiers.sell', tierId: id },
        );
      }
      seen.add(id);
      buyTierRules[id] = buy as BuylistRule;
      sellTierRules[id] = sell as SalesRule;
    }
    if (seen.size !== TIER_IDS.length) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        `tiers must include all ${TIER_IDS.length} rows (${TIER_IDS.join(', ')})`,
        { field: 'tiers' },
      );
    }

    // finishRules (opcional): si vienen, se validan y REEMPLAZAN el eje acabado; si no, se conservan.
    const prevBuy = this.extractTiered<BuylistRule>(
      await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES),
    );
    const prevSell = this.extractTiered<SalesRule>(
      await this.settings.getRaw(SettingKey.SALES_PRICE_RULES),
    );
    const fr = (dto.finishRules ?? {}) as { buy?: unknown; sell?: unknown };
    let buyFinishRules = prevBuy.finishRules;
    let sellFinishRules = prevSell.finishRules;
    if (fr.buy !== undefined) {
      const err = validateTieredRuleSet(
        { tierRules: {}, finishRules: fr.buy },
        isValidBuylistRule,
        'fixed→integer cents ≥ 0, pct→number in [0,100]',
      );
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'finishRules.buy' });
      buyFinishRules = fr.buy as Partial<Record<string, BuylistRule>>;
    }
    if (fr.sell !== undefined) {
      const err = validateTieredRuleSet(
        { tierRules: {}, finishRules: fr.sell },
        isValidSalesRule,
        'fixed→integer cents ≥ 0, pct→number in [0,1000]',
      );
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'finishRules.sell' });
      sellFinishRules = fr.sell as Partial<Record<string, SalesRule>>;
    }

    // fallbackPct (opcional): buy en [0,100], sell en [0,SALES_PCT_MAX].
    const fp = (dto.fallbackPct ?? {}) as { buy?: unknown; sell?: unknown };
    if (fp.buy !== undefined) {
      const err = validateFallbackPct(fp.buy);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'fallbackPct.buy' });
    }
    if (fp.sell !== undefined) {
      const err = validateSalesFallbackPct(fp.sell);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'fallbackPct.sell' });
    }

    // INVARIANTE money-safe (§4.33d): validado contra el MAPA VIGENTE con las reglas de compra NUEVAS.
    const tierMap = await this.readTierMap();
    const offending = this.premiumFixedOffenders(tierMap, buyTierRules);
    if (offending.length > 0) {
      throw BusinessException.validation(
        'PREMIUM_RARITY_FIXED_TIER',
        'a premium rarity would resolve to a fixed buy tier',
        { offending },
      );
    }

    const before = await this.buildTiersResponse();
    const buyJson = { tierRules: buyTierRules, finishRules: buyFinishRules } as unknown as Prisma.InputJsonValue;
    const sellJson = { tierRules: sellTierRules, finishRules: sellFinishRules } as unknown as Prisma.InputJsonValue;
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.BUYLIST_PRICE_RULES },
      create: { key: SettingKey.BUYLIST_PRICE_RULES, valueJson: buyJson, updatedBy: userId },
      update: { valueJson: buyJson, updatedBy: userId },
    });
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.SALES_PRICE_RULES },
      create: { key: SettingKey.SALES_PRICE_RULES, valueJson: sellJson, updatedBy: userId },
      update: { valueJson: sellJson, updatedBy: userId },
    });
    if (fp.buy !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.BUYLIST_PRICE_FALLBACK_PCT },
        create: { key: SettingKey.BUYLIST_PRICE_FALLBACK_PCT, valueJson: fp.buy as number, updatedBy: userId },
        update: { valueJson: fp.buy as number, updatedBy: userId },
      });
    }
    if (fp.sell !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SALES_PRICE_FALLBACK_PCT },
        create: { key: SettingKey.SALES_PRICE_FALLBACK_PCT, valueJson: fp.sell as number, updatedBy: userId },
        update: { valueJson: fp.sell as number, updatedBy: userId },
      });
    }
    const after = await this.buildTiersResponse();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.tiers.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }

  /** Construye la respuesta de `GET /admin/pricing/tier-map` (mismo shape que devuelve el PUT). */
  private async buildTierMapResponse() {
    const tierMap = await this.readTierMap();
    const grouped = await this.prisma.card.groupBy({
      by: ['rarityCanonical'],
      _count: { _all: true },
    });
    const rarities = grouped
      .filter((g) => g.rarityCanonical != null)
      .map((g) => {
        const canonical = g.rarityCanonical as string;
        const info = rarityInfo(canonical);
        const tierId = tierMap[canonical] ?? null;
        return {
          canonical,
          premium: info.premium,
          mapped: info.mapped,
          cardCount: g._count._all,
          tierId,
          source: tierId != null ? ('map' as const) : ('fallback' as const),
        };
      })
      .sort((a, b) => b.cardCount - a.cardCount);
    return {
      tiers: PRICING_TIERS.map((t) => ({ id: t.id, name: t.name, premium: t.premium })),
      rarities,
    };
  }

  /**
   * `GET /admin/pricing/tier-map` (v1.37) — el mapa rareza canónica → tier, unido al catálogo canónico
   * (§4.28c). Muestra rarezas mapeadas y rarezas del catálogo aún sin mapear (`tierId:null`,`source:'fallback'`).
   */
  @Get('tier-map')
  async getTierMap() {
    return this.buildTierMapResponse();
  }

  /**
   * `PUT /admin/pricing/tier-map` (v1.37, §4.33d, Opción B) — reasigna rarezas a tiers (patch PARCIAL).
   * Valida `TierId ∈ {T0..T4}` (422 VALIDATION_ERROR) y que cada key sea una rareza canónica del catálogo
   * (422 UNKNOWN_RARITY). Invariante money-safe: una rareza premium a un tier de compra `fixed` ⇒ 422
   * PREMIUM_RARITY_FIXED_TIER (pares infractores). Auditado. Sin redeploy.
   */
  @Put('tier-map')
  async putTierMap(@Body() dto: TierMapPutDto, @CurrentUser('id') userId: string) {
    const assignments = dto.assignments;
    if (assignments == null || typeof assignments !== 'object' || Array.isArray(assignments)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'assignments must be an object { [canonicalRarity]: TierId }',
        { field: 'assignments' },
      );
    }
    // Normaliza cada key a su canónica y valida (TierId válido + rareza conocida). Money-safe: una key
    // desconocida se RECHAZA (UNKNOWN_RARITY) en vez de sembrar una entrada muerta.
    const normalized: Record<string, TierId> = {};
    for (const [key, tierId] of Object.entries(assignments as Record<string, unknown>)) {
      if (!isTierId(tierId)) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `invalid tier for "${key}": must be one of ${TIER_IDS.join('|')}`,
          { field: 'assignments', rarity: key },
        );
      }
      if (!isRarityMapped(key)) {
        throw BusinessException.validation('UNKNOWN_RARITY', `unknown canonical rarity "${key}"`, {
          rarity: key,
        });
      }
      const canonical = normalizeRarity(key) as string;
      normalized[canonical] = tierId;
    }

    const current = await this.readTierMap();
    const merged: Record<string, TierId> = { ...current, ...normalized };

    // INVARIANTE money-safe (§4.33d): sobre el mapa RESULTANTE completo × las reglas de compra vigentes.
    const buyTierRules = this.extractTiered<BuylistRule>(
      await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES),
    ).tierRules;
    const offending = this.premiumFixedOffenders(merged, buyTierRules);
    if (offending.length > 0) {
      throw BusinessException.validation(
        'PREMIUM_RARITY_FIXED_TIER',
        'a premium rarity would resolve to a fixed buy tier',
        { offending },
      );
    }

    const before = await this.buildTierMapResponse();
    const mapJson = merged as unknown as Prisma.InputJsonValue;
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.PRICING_TIER_MAP },
      create: { key: SettingKey.PRICING_TIER_MAP, valueJson: mapJson, updatedBy: userId },
      update: { valueJson: mapJson, updatedBy: userId },
    });
    const after = await this.buildTierMapResponse();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.tier_map.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }

  // ---------------- Spreads de venta del SELLADO (v1.23-sealed-sales, §4.23c) ----------------
  // Espejo de sales-rules pero keyeado por SealedSubtype. `pct` = markup ARRIBA de mercado.
  // Auditados (super_admin). Surten efecto sin redeploy. API_CONTRACT §M2 (sealed-spreads).

  /** Lee los spreads crudos por presentación + el fallback global. */
  private async readSealedSpreads(): Promise<{
    spreadPctBySubtype: Record<string, number>;
    fallbackPct: number;
  }> {
    const spreadPctBySubtype =
      ((await this.settings.getRaw(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE)) as Record<
        string,
        number
      > | null) ?? {};
    const fallbackPct = await this.settings.getNumber(SettingKey.SEALED_SPREAD_FALLBACK_PCT);
    return { spreadPctBySubtype, fallbackPct };
  }

  @Get('sealed-spreads')
  async getSealedSpreads() {
    return this.readSealedSpreads();
  }

  /**
   * Reemplaza los spreads y/o el fallback (parcial: solo las claves a cambiar). Validación estricta
   * (subtype ∈ {box,etb,bundle,tin,blister}, value/fallback en [0,1000]) → 422 VALIDATION_ERROR.
   * Auditado (before/after). Surte efecto sin redeploy.
   */
  @Put('sealed-spreads')
  async putSealedSpreads(@Body() dto: SealedSpreadsDto, @CurrentUser('id') userId: string) {
    if (dto.spreadPctBySubtype === undefined && dto.fallbackPct === undefined) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Provide spreadPctBySubtype and/or fallbackPct',
      );
    }
    if (dto.spreadPctBySubtype !== undefined) {
      const err = validateSealedSpreads(dto.spreadPctBySubtype);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'spreadPctBySubtype' });
    }
    if (dto.fallbackPct !== undefined) {
      const err = validateSealedSpreadFallback(dto.fallbackPct);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'fallbackPct' });
    }

    const before = await this.readSealedSpreads();
    if (dto.spreadPctBySubtype !== undefined) {
      const spreadsJson = dto.spreadPctBySubtype as unknown as Prisma.InputJsonValue;
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE },
        create: { key: SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE, valueJson: spreadsJson, updatedBy: userId },
        update: { valueJson: spreadsJson, updatedBy: userId },
      });
    }
    if (dto.fallbackPct !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SEALED_SPREAD_FALLBACK_PCT },
        create: { key: SettingKey.SEALED_SPREAD_FALLBACK_PCT, valueJson: dto.fallbackPct, updatedBy: userId },
        update: { valueJson: dto.fallbackPct, updatedBy: userId },
      });
    }
    const after = await this.readSealedSpreads();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.sealed_spreads.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }
}

/**
 * M2 — FX (super_admin). Separado por prefijo de ruta.
 */
@Controller('admin/fx')
@Roles(Role.super_admin)
export class FxController {
  constructor(
    private readonly fx: FxService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  current() {
    return this.fx.getCurrent();
  }

  @Put()
  async setManual(@Body() dto: FxDto, @CurrentUser('id') userId: string) {
    // #13: al menos uno de rate/bufferPct. Omitir `rate` guarda SOLO el colchón (no pinnea tasa).
    if (dto.rate == null && dto.bufferPct == null) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Provide rate and/or bufferPct');
    }
    // FX-B1/FX-B2: mismo validador compartido que PUT /admin/settings → rango [min, MAX] idéntico
    // en ambas puertas (esta NO queda más permisiva). Rechaza overrides absurdos que desbordarían
    // `Int priceMxnCents` en price-ingest. `null`/omitido = no pinnea la tasa (solo colchón).
    if (dto.rate != null) {
      const err = validateFxManualOverrideRate(dto.rate);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'rate' });
    }
    await this.fx.setManual(dto.rate, dto.bufferPct);
    await this.audit.log({
      actorUserId: userId,
      action: 'fx.override',
      after: { rate: dto.rate ?? null, bufferPct: dto.bufferPct ?? null },
    });
    return this.fx.getCurrent();
  }

  @Post('refresh')
  async refresh(@CurrentUser('id') userId: string) {
    const r = await this.fx.refreshFromBanxico();
    await this.audit.log({ actorUserId: userId, action: 'fx.refresh', after: r });
    return this.fx.getCurrent();
  }
}

import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Finish, PendingPriceContext, Prisma, ProductType, Role } from '@prisma/client';
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from './pricing.service';
import { FxService } from './fx.service';
import { SettingsService } from '../settings/settings.service';
import {
  SettingKey,
  validateBuylistRules,
  validateFallbackPct,
  validateSalesRules,
  validateSalesFallbackPct,
  validateSealedSpreads,
  validateSealedSpreadFallback,
  validateFxManualOverrideRate,
} from '../settings/settings.constants';
import { BuylistRule, SalesRule } from '../../common/money';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceSyncJobService } from '../../jobs/price-sync.service';
// N-11: estado en memoria del barrido masivo de precios (barra de progreso del sync).
import { PriceIngestService } from './price-ingest.service';

/** P-6 (§M2): valores válidos del query `?context=` de `GET /admin/pricing/pending`. */
const VALID_PENDING_CONTEXTS: readonly PendingPriceContext[] = Object.values(PendingPriceContext);

class OverrideDto {
  @IsString() cardId!: string;
  @IsString() productType!: ProductType;
  @IsString() gradeKey!: string;
  @IsInt() @Min(0) priceMxnCents!: number;
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

class RarityMapDto {
  entries!: { rarity: string; category: string }[];
}

/** v1.3.1: reemplaza la tabla completa de reglas de buylist por rareza (+ fallback opcional). */
class BuylistRulesDto {
  @IsObject() rules!: Record<string, BuylistRule>;
  @IsOptional() @IsNumber() fallbackPct?: number;
}

/** v1.13-sales-pricing: reemplaza la tabla completa de reglas de VENTA por rareza (+ fallback opcional). */
class SalesRulesDto {
  @IsObject() rules!: Record<string, SalesRule>;
  @IsOptional() @IsNumber() fallbackPct?: number;
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
  ) {}

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

  @Get('card/:cardId')
  history(@Param('cardId') cardId: string) {
    return this.pricing.priceHistory(cardId);
  }

  /**
   * API_CONTRACT §M2: el GET usa el MISMO envelope que el body del PUT,
   * `{ entries: [{ rarity, category }, ...] }` — NO un `Record<string,string>` plano.
   * Internamente la config se persiste como mapa; aquí se proyecta a `entries`.
   */
  @Get('rarity-map')
  async getRarityMap() {
    const raw = (await this.settings.getRaw(SettingKey.RARITY_MAP)) as Record<string, string> | null;
    const map = raw ?? {};
    const entries = Object.entries(map).map(([rarity, category]) => ({ rarity, category }));
    return { entries };
  }

  @Put('rarity-map')
  async putRarityMap(@Body() dto: RarityMapDto, @CurrentUser('id') userId: string) {
    const map: Record<string, string> = {};
    for (const e of dto.entries) map[e.rarity] = e.category;
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.RARITY_MAP },
      create: { key: SettingKey.RARITY_MAP, valueJson: map, updatedBy: userId },
      update: { valueJson: map, updatedBy: userId },
    });
    await this.audit.log({ actorUserId: userId, action: 'pricing.rarity_map.update' });
    const entries = Object.entries(map).map(([rarity, category]) => ({ rarity, category }));
    return { entries };
  }

  // ---------------- Precio de buylist por RAREZA (v1.3.1, §E.1) ----------------

  /** Lee la tabla cruda de reglas + fallback. API_CONTRACT §M2. */
  private async readBuylistRules(): Promise<{ rules: Record<string, BuylistRule>; fallbackPct: number }> {
    const rules =
      ((await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES)) as Record<string, BuylistRule> | null) ??
      {};
    const fallbackPct = await this.settings.getNumber(SettingKey.BUYLIST_PRICE_FALLBACK_PCT);
    return { rules, fallbackPct };
  }

  @Get('buylist-rules')
  async getBuylistRules() {
    return this.readBuylistRules();
  }

  /**
   * Reemplaza la tabla de reglas y/o el fallback. Validación estricta (mode/value/rango) →
   * 422 VALIDATION_ERROR. Surte efecto sin redeploy (criterio 12b). Auditado (before/after).
   */
  @Put('buylist-rules')
  async putBuylistRules(@Body() dto: BuylistRulesDto, @CurrentUser('id') userId: string) {
    const rulesErr = validateBuylistRules(dto.rules);
    if (rulesErr) throw BusinessException.validation('VALIDATION_ERROR', rulesErr, { field: 'rules' });
    if (dto.fallbackPct !== undefined) {
      const fbErr = validateFallbackPct(dto.fallbackPct);
      if (fbErr) throw BusinessException.validation('VALIDATION_ERROR', fbErr, { field: 'fallbackPct' });
    }

    const before = await this.readBuylistRules();
    const rulesJson = dto.rules as unknown as Prisma.InputJsonValue;
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.BUYLIST_PRICE_RULES },
      create: { key: SettingKey.BUYLIST_PRICE_RULES, valueJson: rulesJson, updatedBy: userId },
      update: { valueJson: rulesJson, updatedBy: userId },
    });
    if (dto.fallbackPct !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.BUYLIST_PRICE_FALLBACK_PCT },
        create: { key: SettingKey.BUYLIST_PRICE_FALLBACK_PCT, valueJson: dto.fallbackPct, updatedBy: userId },
        update: { valueJson: dto.fallbackPct, updatedBy: userId },
      });
    }
    const after = await this.readBuylistRules();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.buylist_rules.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }

  /**
   * Rarezas distintas del catálogo sincronizado, unidas a sus reglas (para poblar el editor M2).
   * Devuelve rarezas con regla explícita y rarezas del catálogo aún sin regla (muestran el fallback).
   * Ordenado por cardCount desc. API_CONTRACT §M2.
   */
  @Get('rarities')
  async rarities() {
    const { rules, fallbackPct } = await this.readBuylistRules();
    const grouped = await this.prisma.card.groupBy({
      by: ['rarity'],
      _count: { _all: true },
    });
    const rarities = grouped
      .filter((g): g is { rarity: string; _count: { _all: number } } => g.rarity != null)
      .map((g) => {
        const explicit = rules[g.rarity];
        return {
          rarity: g.rarity,
          cardCount: g._count._all,
          rule: explicit ?? { mode: 'pct' as const, value: fallbackPct },
          source: explicit ? ('rule' as const) : ('fallback' as const),
        };
      })
      .sort((a, b) => b.cardCount - a.cardCount);
    return { fallbackPct, rarities };
  }

  // ---------------- Precio de VENTA por RAREZA (v1.13-sales-pricing, §4.14c) ----------------
  // Clones 1:1 del patrón buylist de arriba. Auditados (super_admin). API_CONTRACT §M2.
  // OJO semántica: en venta `pct` = markup ARRIBA de mercado (no % de la referencia como en buylist);
  // la matemática vive en money.computeSalePriceForRarity — aquí solo se lee/escribe la tabla cruda.

  /** Lee la tabla cruda de reglas de VENTA + fallback. API_CONTRACT §M2. */
  private async readSalesRules(): Promise<{ rules: Record<string, SalesRule>; fallbackPct: number }> {
    const rules =
      ((await this.settings.getRaw(SettingKey.SALES_PRICE_RULES)) as Record<string, SalesRule> | null) ?? {};
    const fallbackPct = await this.settings.getNumber(SettingKey.SALES_PRICE_FALLBACK_PCT);
    return { rules, fallbackPct };
  }

  @Get('sales-rules')
  async getSalesRules() {
    return this.readSalesRules();
  }

  /**
   * Reemplaza la tabla de reglas de VENTA y/o el fallback. Validación estricta (mode/value/rango,
   * pct en [0,1000]) → 422 VALIDATION_ERROR. Surte efecto sin redeploy. Auditado (before/after).
   */
  @Put('sales-rules')
  async putSalesRules(@Body() dto: SalesRulesDto, @CurrentUser('id') userId: string) {
    const rulesErr = validateSalesRules(dto.rules);
    if (rulesErr) throw BusinessException.validation('VALIDATION_ERROR', rulesErr, { field: 'rules' });
    if (dto.fallbackPct !== undefined) {
      const fbErr = validateSalesFallbackPct(dto.fallbackPct);
      if (fbErr) throw BusinessException.validation('VALIDATION_ERROR', fbErr, { field: 'fallbackPct' });
    }

    const before = await this.readSalesRules();
    const rulesJson = dto.rules as unknown as Prisma.InputJsonValue;
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.SALES_PRICE_RULES },
      create: { key: SettingKey.SALES_PRICE_RULES, valueJson: rulesJson, updatedBy: userId },
      update: { valueJson: rulesJson, updatedBy: userId },
    });
    if (dto.fallbackPct !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SALES_PRICE_FALLBACK_PCT },
        create: { key: SettingKey.SALES_PRICE_FALLBACK_PCT, valueJson: dto.fallbackPct, updatedBy: userId },
        update: { valueJson: dto.fallbackPct, updatedBy: userId },
      });
    }
    const after = await this.readSalesRules();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.sales_rules.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }

  /**
   * Rarezas distintas del catálogo unidas a sus reglas de VENTA (para poblar el editor M2).
   * Devuelve rarezas con regla explícita y rarezas del catálogo aún sin regla (muestran el fallback).
   * Ordenado por cardCount desc. API_CONTRACT §M2.
   */
  @Get('sales-rarities')
  async salesRarities() {
    const { rules, fallbackPct } = await this.readSalesRules();
    const grouped = await this.prisma.card.groupBy({
      by: ['rarity'],
      _count: { _all: true },
    });
    const rarities = grouped
      .filter((g): g is { rarity: string; _count: { _all: number } } => g.rarity != null)
      .map((g) => {
        const explicit = rules[g.rarity];
        return {
          rarity: g.rarity,
          cardCount: g._count._all,
          rule: explicit ?? { mode: 'pct' as const, value: fallbackPct },
          source: explicit ? ('rule' as const) : ('fallback' as const),
        };
      })
      .sort((a, b) => b.cardCount - a.cardCount);
    return { fallbackPct, rarities };
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

import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Prisma, ProductType, Role } from '@prisma/client';
import { IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
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
} from '../settings/settings.constants';
import { BuylistRule } from '../../common/money';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceSyncJobService } from '../../jobs/price-sync.service';

class OverrideDto {
  @IsString() cardId!: string;
  @IsString() productType!: ProductType;
  @IsString() gradeKey!: string;
  @IsInt() @Min(0) priceMxnCents!: number;
}

class FxDto {
  @IsInt() @Min(1) rate!: number;
  @IsInt() @Min(0) bufferPct!: number;
}

class RarityMapDto {
  entries!: { rarity: string; category: string }[];
}

/** v1.3.1: reemplaza la tabla completa de reglas de buylist por rareza (+ fallback opcional). */
class BuylistRulesDto {
  @IsObject() rules!: Record<string, BuylistRule>;
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
  ) {}

  @Post('sync')
  async sync(@Body() dto: SyncDto, @CurrentUser('id') userId: string) {
    const result = await this.priceSync.enqueue(dto.scope ?? 'all_vault', dto.cardIds);
    await this.audit.log({ actorUserId: userId, action: 'pricing.sync', entityType: 'PriceReference' });
    return result;
  }

  @Get('pending')
  pending() {
    return this.pricing.pendingQueue();
  }

  @Post('override')
  async override(@Body() dto: OverrideDto, @CurrentUser('id') userId: string) {
    const ref = await this.pricing.manualOverride(
      dto.cardId,
      dto.productType,
      dto.gradeKey,
      dto.priceMxnCents,
    );
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.override',
      entityType: 'PriceReference',
      entityId: ref.id,
      after: { priceMxnCents: dto.priceMxnCents },
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
    await this.fx.setManual(dto.rate, dto.bufferPct);
    await this.audit.log({
      actorUserId: userId,
      action: 'fx.override',
      after: { rate: dto.rate, bufferPct: dto.bufferPct },
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

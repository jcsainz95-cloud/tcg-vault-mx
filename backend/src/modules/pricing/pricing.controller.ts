import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ProductType, Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PricingService } from './pricing.service';
import { FxService } from './fx.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
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

  @Get('rarity-map')
  async getRarityMap() {
    return this.settings.getRaw(SettingKey.RARITY_MAP);
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
    return map;
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

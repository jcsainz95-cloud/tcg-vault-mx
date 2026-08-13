import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeFeeConfig } from '../../common/money';
import { SETTING_DEFAULTS, SETTING_DTO_MAP, SettingKey, SettingKeyType } from './settings.constants';

/**
 * SettingsService — Lectura/escritura de los diales M10 (ConfigSetting).
 * Editables sin redeploy. Provee helpers tipados para el resto de módulos.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lee un dial; si no existe fila, devuelve el default. */
  async get<T = unknown>(key: SettingKeyType): Promise<T> {
    const row = await this.prisma.configSetting.findUnique({ where: { key } });
    if (row) return row.valueJson as T;
    return SETTING_DEFAULTS[key] as T;
  }

  async getNumber(key: SettingKeyType): Promise<number> {
    return Number(await this.get<number>(key));
  }

  async getString(key: SettingKeyType): Promise<string> {
    return String(await this.get<string>(key));
  }

  /** Config de comisión Stripe para el gross-up (ARCHITECTURE §5.1). */
  async getStripeFee(): Promise<StripeFeeConfig> {
    return {
      stripePct: await this.getNumber(SettingKey.STRIPE_FEE_PCT),
      stripeFixedCents: await this.getNumber(SettingKey.STRIPE_FEE_FIXED_CENTS),
    };
  }

  /** Devuelve todos los diales como el DTO camelCase del contrato (API_CONTRACT §M10). */
  async getAllDto(): Promise<Record<string, unknown>> {
    const dto: Record<string, unknown> = {};
    for (const [dtoKey, settingKey] of Object.entries(SETTING_DTO_MAP)) {
      dto[dtoKey] = await this.get(settingKey);
    }
    return dto;
  }

  /** Actualiza uno o varios diales (upsert). Devuelve los cambios aplicados. */
  async update(
    dtoPartial: Record<string, unknown>,
    actorUserId?: string,
  ): Promise<Record<string, unknown>> {
    const applied: Record<string, unknown> = {};
    for (const [dtoKey, value] of Object.entries(dtoPartial)) {
      const settingKey = SETTING_DTO_MAP[dtoKey];
      if (!settingKey) continue;
      await this.prisma.configSetting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, valueJson: value as object, updatedBy: actorUserId },
        update: { valueJson: value as object, updatedBy: actorUserId },
      });
      applied[dtoKey] = value;
    }
    return applied;
  }

  async getRaw(key: SettingKeyType): Promise<unknown> {
    return this.get(key);
  }
}

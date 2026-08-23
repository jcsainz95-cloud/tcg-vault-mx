import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeFeeConfig } from '../../common/money';
import { BusinessException } from '../../common/business.exception';
import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  SettingKeyType,
} from './settings.constants';

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
      // v1.40 (Enmienda A, P-37): el IVA que Stripe MX cobra SOBRE su comisión deja de tener dial
      // propio (`stripe_fee_iva_pct`, retirado) y se DERIVA de la fuente única `IVA_PCT` (porcentaje
      // [0,100] → fracción). Matemáticamente idéntico al centavo (16/100 = 0.16); el neteo NO cambia.
      // La clave de BD `stripe_fee_iva_pct` queda inerte: NUNCA se lee (jamás cae a la fila vieja ni a 0).
      stripeFeeIvaPct: (await this.getNumber(SettingKey.IVA_PCT)) / 100,
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

  /**
   * Actualiza uno o varios diales (upsert). Devuelve los cambios aplicados.
   * Fix correctness #2: valida CADA dial por tipo+rango antes de persistir y RECHAZA
   * keys desconocidas con 422 (antes se ignoraban en silencio). La validación es
   * "todo o nada": si algún valor es inválido, no se escribe ninguno.
   */
  async update(
    dtoPartial: Record<string, unknown>,
    actorUserId?: string,
  ): Promise<Record<string, unknown>> {
    const errors: Record<string, string> = {};
    const validated: { dtoKey: string; settingKey: SettingKeyType; value: unknown }[] = [];

    for (const [dtoKey, value] of Object.entries(dtoPartial)) {
      const settingKey = SETTING_DTO_MAP[dtoKey];
      if (!settingKey) {
        errors[dtoKey] = 'unknown setting key';
        continue;
      }
      const validate = SETTING_VALIDATORS[settingKey];
      const msg = validate ? validate(value) : null;
      if (msg) {
        errors[dtoKey] = msg;
        continue;
      }
      validated.push({ dtoKey, settingKey, value });
    }

    if (Object.keys(errors).length > 0) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Invalid settings payload', { errors });
    }

    const applied: Record<string, unknown> = {};
    for (const { dtoKey, settingKey, value } of validated) {
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

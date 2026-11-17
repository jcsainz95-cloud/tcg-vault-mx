import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';

/** `pattern_classify_enabled` (§PRICE-PATTERN): `off` ⇒ el clasificador NO produce `variant` (reversa funcional). Sin servicio de ajustes ⇒ encendido. */
export async function patternClassifyEnabled(settings?: Pick<SettingsService, 'getString'>): Promise<boolean> {
  if (!settings) return true;
  try {
    return (await settings.getString(SettingKey.PATTERN_CLASSIFY_ENABLED)) !== 'off';
  } catch {
    return true;
  }
}

import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { SpendAlertsModule } from '../spend-alerts/spend-alerts.module';

/**
 * 🔒 D2g (§19.30.2 (1), §19.32.9): importa `SpendAlertsModule` para AG-22 (`owner_setting_denied`). `SettingsModule` es `@Global`
 * y `SpendAlertsModule` NO lo importa (lee `SettingsService` por ser global) ⇒ sin ciclo de imports; medido al arrancar la app
 * (`BACKEND_NOTES §65`), sin `forwardRef`.
 */
@Global()
@Module({
  imports: [SpendAlertsModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}

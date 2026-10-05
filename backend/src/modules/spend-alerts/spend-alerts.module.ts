/**
 * SpendAlertsModule — 💰 la base de avisos al dueño (API_CONTRACT §M4-SHIP.19.29.5, §19.30, §19.31.8).
 *
 *  - `SpendAlertsService`: `raise`/`resolve`/`observeBalance` (D2c; firmas congeladas) y los únicos otros escritores de la tabla.
 *  - D2g: el despacho del correo (`SpendMailService`), el panel (`SpendAlertsController` + `SpendAlertsPanelService`), AG-22
 *    (`StaffControlAlertsService`), la lectura de saldo cacheada (`ProviderBalanceService`) y los dos jobs (`SpendWatchService`,
 *    `SpendDigestService`; su registro en `jobs/` es la costura C1, §19.33.9: cron y disparo manual).
 *
 * Lo importan `shipments` (disparadores D2c/D2d), `admin` (AG-22 de Usuarios) y `settings` (AG-22 de los diales del dueño).
 * `SettingsModule` es `@Global` y este módulo NO lo importa ⇒ sin ciclo de imports (medido al arrancar, `BACKEND_NOTES §65`).
 * `ShippingProviderModule` aporta el puerto para el saldo (solo `import`; ⛔ D2g no toca `shipping-provider/`).
 */
import { Module } from '@nestjs/common';
import { ShippingProviderModule } from '../shipping-provider/shipping-provider.module';
import { SpendAlertsService } from './spend-alerts.service';
import { SpendMailService } from './spend-mail.service';
import { SpendAlertsPanelService } from './spend-alerts-panel.service';
import { SpendAlertsController } from './spend-alerts.controller';
import { StaffControlAlertsService } from './staff-control.service';
import { ProviderBalanceService } from './provider-balance.service';
import { SpendWatchService } from './spend-watch.service';
import { SpendDigestService } from './spend-digest.service';
import { SPEND_ALERTS_CLOCK, systemSpendClock } from './spend-alerts.constants';

@Module({
  imports: [ShippingProviderModule],
  providers: [
    SpendAlertsService,
    SpendMailService,
    SpendAlertsPanelService,
    StaffControlAlertsService,
    ProviderBalanceService,
    SpendWatchService,
    SpendDigestService,
    // Un reloj del módulo; las pruebas lo sustituyen (PS-149, PS-154).
    { provide: SPEND_ALERTS_CLOCK, useValue: systemSpendClock },
  ],
  controllers: [SpendAlertsController],
  exports: [SpendAlertsService, SpendMailService, StaffControlAlertsService, ProviderBalanceService, SpendWatchService, SpendDigestService],
})
export class SpendAlertsModule {}

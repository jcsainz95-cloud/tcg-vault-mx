/**
 * SpendAlertsModule — 💰 la base de avisos al dueño (API_CONTRACT §M4-SHIP.19.29.5). Lo importa `shipments` (D2c: los
 * disparadores AG-1…AG-5, AG-7, AG-8 (a), AG-9 (a), AG-13). El despacho del correo, el panel y los jobs son D2g.
 */
import { Module } from '@nestjs/common';
import { SpendAlertsService } from './spend-alerts.service';

@Module({
  providers: [SpendAlertsService],
  exports: [SpendAlertsService],
})
export class SpendAlertsModule {}

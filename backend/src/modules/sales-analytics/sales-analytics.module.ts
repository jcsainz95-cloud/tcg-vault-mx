/**
 * SalesAnalyticsModule — 💰 la analítica de ventas del dueño (§AN, API_CONTRACT §15; ARCHITECTURE §4.64.3: módulo propio).
 * Lo importan `admin` (rutas en `AdminReportsController`) y `spend-alerts` (la línea de ventas del resumen de las 08:00,
 * 624). ⛔ No importa ninguno de los dos (Prisma es `@Global`; `pnl-core` y `mx-day` son funciones, no módulos) ⇒ sin ciclo.
 */
import { Module } from '@nestjs/common';
import { SalesAnalyticsService } from './sales-analytics.service';

@Module({
  providers: [SalesAnalyticsService],
  exports: [SalesAnalyticsService],
})
export class SalesAnalyticsModule {}

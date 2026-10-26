import { Module } from '@nestjs/common';
import { DiscountsService } from './discounts.service';
import { AdminDiscountsService } from './admin-discounts.service';
import { AdminDiscountCodeBatchesController, AdminDiscountCodesController } from './admin-discounts.controller';

/**
 * 💰 v1.110⟨descuentos⟩ (API_CONTRACT §DSC) — módulo de códigos de descuento. Fase 1 (núcleo de dinero): validez, límite de
 * intentos y ciclo del uso; lo consumen `orders` (quote y sesión de cuenta e invitado) y `shipments` (retiro). Fase 2
 * (v1.110.1, §DSC.7): las 21 rutas del dueño (`super_admin`). `PrismaService`, `SettingsService`, `PiiCryptoService` y
 * `AuditService` son globales.
 */
@Module({
  controllers: [AdminDiscountCodesController, AdminDiscountCodeBatchesController],
  providers: [DiscountsService, AdminDiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}

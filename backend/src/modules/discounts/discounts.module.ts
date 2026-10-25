import { Module } from '@nestjs/common';
import { DiscountsService } from './discounts.service';

/**
 * 💰 v1.110⟨descuentos⟩ (API_CONTRACT §DSC) — módulo de códigos de descuento, fase 1 (núcleo de dinero): validez, límite
 * de intentos y ciclo del uso. Lo consumen `orders` (quote y sesión de cuenta e invitado) y `shipments` (retiro).
 * Las rutas `super_admin` (§DSC.7) son la fase 2. `PrismaService`, `SettingsService` y `PiiCryptoService` son globales.
 */
@Module({
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}

import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { AdminShipmentsController } from './admin-shipments.controller';
import { ShipmentPrepService } from './shipment-prep.service';
import { ShipmentAddressService } from './shipment-address.service';
import { GeoModule } from '../shipping-provider/geo/geo.module';
import { ShippingProviderModule } from '../shipping-provider/shipping-provider.module';
import { ShipmentQuoteService } from './label-quote.service';
import { SHIPMENTS_LABEL_CLOCK, systemLabelClock } from './label-clock';

@Module({
  // ⭐ v1.80.12 (M-64): `GeoModule` — la corrección de la dirección valida contra la lista del CP (§M4-SHIP.19.20.1).
  // ⭐💰 v1.81 D2b/D2c (§M4-SHIP.19.4): el proveedor de guías entra AQUÍ (D1 lo dejó sin importar a propósito).
  imports: [GeoModule, ShippingProviderModule],
  providers: [
    ShipmentsService,
    ShipmentPrepService,
    ShipmentAddressService,
    ShipmentQuoteService,
    // 🔒 UN reloj para la guía (§19.29.1.4, C-17); las pruebas lo sustituyen.
    { provide: SHIPMENTS_LABEL_CLOCK, useValue: systemLabelClock },
  ],
  controllers: [ShipmentsController, AdminShipmentsController],
  exports: [ShipmentsService, ShipmentPrepService],
})
export class ShipmentsModule {}

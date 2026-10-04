import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { AdminShipmentsController } from './admin-shipments.controller';
import { ShipmentPrepService } from './shipment-prep.service';
import { ShipmentAddressService } from './shipment-address.service';
import { GeoModule } from '../shipping-provider/geo/geo.module';

@Module({
  // ⭐ v1.80.12 (M-64): `GeoModule` — la corrección de la dirección valida contra la lista del CP (§M4-SHIP.19.20.1).
  imports: [GeoModule],
  providers: [ShipmentsService, ShipmentPrepService, ShipmentAddressService],
  controllers: [ShipmentsController, AdminShipmentsController],
  exports: [ShipmentsService, ShipmentPrepService],
})
export class ShipmentsModule {}

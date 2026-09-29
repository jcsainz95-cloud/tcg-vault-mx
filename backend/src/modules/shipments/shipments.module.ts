import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { AdminShipmentsController } from './admin-shipments.controller';
import { ShipmentPrepService } from './shipment-prep.service';

@Module({
  providers: [ShipmentsService, ShipmentPrepService],
  controllers: [ShipmentsController, AdminShipmentsController],
  exports: [ShipmentsService, ShipmentPrepService],
})
export class ShipmentsModule {}

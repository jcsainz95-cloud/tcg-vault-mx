import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { AdminShipmentsController } from './admin-shipments.controller';

@Module({
  providers: [ShipmentsService],
  controllers: [ShipmentsController, AdminShipmentsController],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}

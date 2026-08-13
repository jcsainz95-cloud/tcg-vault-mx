import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { PricingModule } from '../pricing/pricing.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [PricingModule, CatalogModule],
  providers: [OrdersService],
  controllers: [OrdersController, AdminOrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}

import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { MasterSetService } from './master-set.service';
import { InventoryController } from './inventory.controller';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule],
  providers: [InventoryService, MasterSetService],
  controllers: [InventoryController],
  exports: [InventoryService, MasterSetService],
})
export class InventoryModule {}

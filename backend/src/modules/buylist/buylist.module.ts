import { Module } from '@nestjs/common';
import { BuylistService } from './buylist.service';
import { BuylistController } from './buylist.controller';
import { AdminBuylistController } from './admin-buylist.controller';
import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PricingModule, UsersModule],
  providers: [BuylistService],
  controllers: [BuylistController, AdminBuylistController],
  exports: [BuylistService],
})
export class BuylistModule {}

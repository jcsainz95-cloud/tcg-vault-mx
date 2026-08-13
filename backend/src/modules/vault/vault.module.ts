import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule],
  providers: [VaultService],
  controllers: [VaultController],
})
export class VaultModule {}

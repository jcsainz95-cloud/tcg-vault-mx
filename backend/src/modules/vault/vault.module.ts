import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { PricingModule } from '../pricing/pricing.module';
import { PortfolioSnapshotJobService } from '../../jobs/portfolio-snapshot.service';

/**
 * VaultModule — bóveda/portafolio del cliente. Aloja también el job
 * `portfolio-snapshot` (BE-5) porque depende de VaultService (evita ciclos con JobsModule).
 */
@Module({
  imports: [PricingModule],
  providers: [VaultService, PortfolioSnapshotJobService],
  controllers: [VaultController],
  exports: [VaultService, PortfolioSnapshotJobService],
})
export class VaultModule {}

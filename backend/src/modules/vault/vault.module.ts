import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { AdminVaultsService } from './admin-vaults.service';
import { AdminVaultsController } from './admin-vaults.controller';
import { PricingModule } from '../pricing/pricing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PortfolioSnapshotJobService } from '../../jobs/portfolio-snapshot.service';

/**
 * VaultModule — bóveda/portafolio del cliente. Aloja también el job
 * `portfolio-snapshot` (BE-5) porque depende de VaultService (evita ciclos con JobsModule).
 * v1.20-master-set-everywhere (§4.20a): gana las vistas master-set por scope — rutas de cliente
 * `GET /vault/master-sets[...]` (VaultController) y las de admin `GET /admin/vaults[...]`
 * (AdminVaultsController, vault_operator+). El read model vive en MasterSetService
 * (InventoryModule, exportado); aquí solo se consumen sus scopes.
 */
@Module({
  imports: [PricingModule, InventoryModule],
  providers: [VaultService, AdminVaultsService, PortfolioSnapshotJobService],
  controllers: [VaultController, AdminVaultsController],
  exports: [VaultService, PortfolioSnapshotJobService],
})
export class VaultModule {}

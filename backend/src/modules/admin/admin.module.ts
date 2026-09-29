import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AdminDashboardController,
  AdminFinanceController,
  AdminReportsController,
  AdminUsersController,
} from './admin.controller';
import { PricingModule } from '../pricing/pricing.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { UsersModule } from '../users/users.module';

@Module({
  // UploadsModule provee UploadsService para purgar la imagen de INE al borrar un usuario (M6).
  // v1.80 (§M4-SHIP.11): `ShipmentsModule` para `workQueue.toPrepare` (el mismo cuerpo que el `summary` de la cola).
  imports: [PricingModule, UploadsModule, ShipmentsModule, UsersModule],
  providers: [AdminService],
  controllers: [
    AdminUsersController,
    AdminFinanceController,
    AdminReportsController,
    AdminDashboardController,
  ],
})
export class AdminModule {}

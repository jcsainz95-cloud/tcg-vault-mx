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
import { AuthModule } from '../auth/auth.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { UsersModule } from '../users/users.module';
import { SpendAlertsModule } from '../spend-alerts/spend-alerts.module';

@Module({
  // UploadsModule provee UploadsService para purgar la imagen de INE al borrar un usuario (M6).
  // AuthModule (v1.80, C7): provee `PasswordAttemptsService` — el reset por admin levanta el candado.
  // v1.80 (§M4-SHIP.11): `ShipmentsModule` para `workQueue.toPrepare` (el mismo cuerpo que el `summary` de la cola).
  // v1.80.7 (punto 19): `UsersModule` para `UsersService.eraseClabe` (`C-CLABE-1`).
  // 🔒 D2g (§19.30.2 (3)): `SpendAlertsModule` para AG-22 (actos de un no dueño sobre cuentas de personal).
  imports: [PricingModule, UploadsModule, AuthModule, ShipmentsModule, UsersModule, SpendAlertsModule],
  providers: [AdminService],
  controllers: [
    AdminUsersController,
    AdminFinanceController,
    AdminReportsController,
    AdminDashboardController,
  ],
})
export class AdminModule {}

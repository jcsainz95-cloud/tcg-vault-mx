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

@Module({
  // UploadsModule provee UploadsService para purgar la imagen de INE al borrar un usuario (M6).
  // AuthModule (v1.80, C7): provee `PasswordAttemptsService` — el reset por admin levanta el candado.
  imports: [PricingModule, UploadsModule, AuthModule],
  providers: [AdminService],
  controllers: [
    AdminUsersController,
    AdminFinanceController,
    AdminReportsController,
    AdminDashboardController,
  ],
})
export class AdminModule {}

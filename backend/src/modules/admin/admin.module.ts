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

@Module({
  // UploadsModule provee UploadsService para purgar la imagen de INE al borrar un usuario (M6).
  imports: [PricingModule, UploadsModule],
  providers: [AdminService],
  controllers: [
    AdminUsersController,
    AdminFinanceController,
    AdminReportsController,
    AdminDashboardController,
  ],
})
export class AdminModule {}

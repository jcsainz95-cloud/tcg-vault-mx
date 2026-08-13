import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  AdminDashboardController,
  AdminFinanceController,
  AdminReportsController,
  AdminUsersController,
} from './admin.controller';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule],
  providers: [AdminService],
  controllers: [
    AdminUsersController,
    AdminFinanceController,
    AdminReportsController,
    AdminDashboardController,
  ],
})
export class AdminModule {}

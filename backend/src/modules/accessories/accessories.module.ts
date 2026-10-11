/**
 * accessories.module.ts — v1.86⟨accesorios⟩ stream (A): tienda pública, panel, fotos en Postgres y existencias manuales
 * (API_CONTRACT §AC.3, §AC.11). ⛔ Sin cobro: apartar, liquidar, reponer y la caja del envío son del stream (B).
 * ⛔ No importa `UploadsModule` ni S3 (I-AC-6; candado AC-B5).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { AccessoriesController } from './accessories.controller';
import { AccessoriesService } from './accessories.service';
import { AdminAccessoriesController } from './admin-accessories.controller';
import { AdminAccessoriesService } from './admin-accessories.service';

@Module({
  imports: [PrismaModule, AuditModule, SettingsModule],
  controllers: [AccessoriesController, AdminAccessoriesController],
  providers: [AccessoriesService, AdminAccessoriesService],
  exports: [AccessoriesService],
})
export class AccessoriesModule {}

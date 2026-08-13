import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { VaultModule } from './modules/vault/vault.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { BuylistModule } from './modules/buylist/buylist.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './jobs/jobs.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { MoneyOutGuard } from './common/guards/money-out.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // SEC-C1: rate-limiting global (defensa contra fuerza bruta / DoS de app).
    // Límite general holgado; los endpoints de auth sensibles lo endurecen con @Throttle.
    // Storage in-memory (por instancia). En despliegue multi-instancia devops debe
    // añadir storage compartido (Redis) y `trust proxy` en el borde (ver DEVOPS_NOTES).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    SettingsModule,
    PaymentsModule,
    AuthModule,
    UsersModule,
    PricingModule,
    CatalogModule,
    InventoryModule,
    OrdersModule,
    VaultModule,
    ShipmentsModule,
    BuylistModule,
    DisputesModule,
    UploadsModule,
    AdminModule,
    JobsModule,
  ],
  providers: [
    // Orden: rate-limit → autenticación → rol → dinero saliente. (APP_GUARD respeta el orden.)
    // El throttling corre antes que la autenticación para frenar fuerza bruta en /auth/login.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: MoneyOutGuard },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
// v1.51 (M-46, §4.39f): módulo @Global que provee SOLO `INVENTORY_POSITION_PORT` (solo lectura, en
// lote). Existe para que `buylist` lea la posición de inventario SIN importar `InventoryModule`:
// los dos viven en streams distintos y tienen que poder mergear por separado.
import { InventoryPositionModule } from './modules/inventory/inventory-position.module';
// v1.51.18 (BL-25, §4.39m.5): puerto de DISPARO de publicación. @Global, exporta SOLO el token.
import { InventoryPublishModule } from './modules/inventory/inventory-publish.module';
import { OrdersModule } from './modules/orders/orders.module';
import { VaultModule } from './modules/vault/vault.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { BuylistModule } from './modules/buylist/buylist.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { EmailVerifiedGuard } from './common/guards/email-verified.guard';
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
    CryptoModule,
    AuditModule,
    SettingsModule,
    PaymentsModule,
    AuthModule,
    UsersModule,
    PricingModule,
    CatalogModule,
    InventoryModule,
    InventoryPositionModule,
    InventoryPublishModule,
    OrdersModule,
    VaultModule,
    ShipmentsModule,
    BuylistModule,
    DisputesModule,
    UploadsModule,
    AdminModule,
    HealthModule,
    JobsModule,
  ],
  providers: [
    // Orden: rate-limit → autenticación → rol → correo verificado → dinero saliente.
    // (APP_GUARD respeta el orden.) El throttling corre antes que la autenticación para frenar
    // fuerza bruta en /auth/login. EmailVerifiedGuard (v1.5) corre tras JwtAuthGuard/RolesGuard,
    // usando `req.user.emailVerified` para gatear las acciones sensibles marcadas.
    // AppThrottlerGuard = ThrottlerGuard + skip SOLO bajo NODE_ENV=test (ver config/test-env.ts).
    // Los límites (global 300/min y los @Throttle por handler) NO cambian en entornos reales.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
    { provide: APP_GUARD, useClass: MoneyOutGuard },
  ],
})
export class AppModule {}

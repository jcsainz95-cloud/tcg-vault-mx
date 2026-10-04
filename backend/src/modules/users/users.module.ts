import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
// v1.74 (§R.2) — la campana. `PendingsService` es **la única pieza compartida** del centro de avisos
// (§4.54.5) y vive en `users` porque su lista blanca cuelga del expediente de identidad.
import { MePendingsController } from './me-pendings.controller';
import { PendingsService } from './pendings.service';
import { UploadsModule } from '../uploads/uploads.module';
import { GeoModule } from '../shipping-provider/geo/geo.module';

@Module({
  // v1.69 (P-78, BK-4): `UploadsService` para borrar la imagen de INE SUSTITUIDA al re-subir
  // (§M6-K.4.1). Mismo motivo por el que `AdminModule` ya lo importaba para el borrado de usuario.
  // ⭐ v1.81 (M-64): `GeoModule` — validar la colonia contra la lista del CP (§M4-SHIP.19.5).
  imports: [UploadsModule, GeoModule],
  providers: [UsersService, PendingsService],
  controllers: [UsersController, MePendingsController],
  exports: [UsersService],
})
export class UsersModule {}

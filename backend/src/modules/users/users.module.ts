import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  // v1.69 (P-78, BK-4): `UploadsService` para borrar la imagen de INE SUSTITUIDA al re-subir
  // (§M6-K.4.1). Mismo motivo por el que `AdminModule` ya lo importaba para el borrado de usuario.
  imports: [UploadsModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}

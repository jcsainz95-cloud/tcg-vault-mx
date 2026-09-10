import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { UploadsService } from './uploads.service';

class PresignDto {
  // v1.2: único propósito válido es `kyc_ine`. Se recibe como string libre y el servicio
  // rechaza cualquier otro valor (incl. `inventory_photo`/`dispute_claim`) con 422 VALIDATION_ERROR
  // (regla de negocio del contrato §8), no con el 400 del ValidationPipe.
  @IsString() purpose!: string;
  @IsString() contentType!: string;
  // S-B3 / P-UP-1: tamaño declarado (bytes). **OBLIGATORIO** desde P-UP-1 — omitirlo era la vía
  // de evasión del tope (ver `uploads.service.ts`). Se deja `@IsOptional()` A PROPÓSITO para que la
  // AUSENCIA la rechace el servicio con `422 VALIDATION_ERROR` (misma forma de error que `purpose`,
  // contrato §8) y no con el `400` del ValidationPipe; el TIPO sí lo valida aquí cuando viene.
  @IsOptional() @IsInt() @Min(1) contentLength?: number;
}

@Controller('uploads')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  @HttpCode(200)
  presign(@Body() dto: PresignDto) {
    return this.uploads.presign(dto.purpose, dto.contentType, dto.contentLength);
  }
}

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
  // S-B3: tamaño declarado (bytes). Opcional (aditivo al contrato §8): si viene, el servicio lo
  // valida contra el tope y lo FIJA en la firma para acotar el PUT.
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

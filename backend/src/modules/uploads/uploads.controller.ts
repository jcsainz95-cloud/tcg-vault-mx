import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActorThrottlerGuard } from '../admin/actor-throttler.guard';
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

  /**
   * ⭐ v1.70 (`C19` / `SEC-PII-5`) — **tope propio, y por ACTOR.** Antes caía en el global de 300/min
   * **por IP**, que es justo el eje que `P-RL-1` (ALTA, abierto) esquiva rotando `X-Forwarded-For`:
   * una manguera de objetos de 10 MiB que **nacen huérfanos** (un presign que nadie ata a un
   * expediente deja un objeto que ninguna purga alcanza). 20/min es holgado para una persona que
   * sube dos caras de una credencial y corrige alguna foto; no lo es para un bucle.
   * ⚠️ Mismo guard que `…/kyc/ine-links`: el eje correcto aquí es **la sesión**, no la red.
   *
   * ⭐ v1.70 (`C15`): el `userId` baja al servicio porque **la key se registra a su nombre**.
   */
  @Post('presign')
  @HttpCode(200)
  @UseGuards(ActorThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  presign(@CurrentUser('id') userId: string, @Body() dto: PresignDto) {
    return this.uploads.presign(userId, dto.purpose, dto.contentType, dto.contentLength);
  }
}

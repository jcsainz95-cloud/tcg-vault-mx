/**
 * `POST /api/v1/measurement/banner-response` — público (API_CONTRACT §MKT.H.3). 204 siempre que el body tenga forma
 * válida (también con `MEASUREMENT_MODE=off`, sin escribir). 400 `VALIDATION_ERROR` sin forma; 429 a partir de 30/h por IP.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, Post, ValidationPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional } from 'class-validator';
import type { BannerResponse } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { BANNER_RESPONSES, BannerResponseService } from './banner-response.service';

export class BannerResponseDto {
  @IsIn([...BANNER_RESPONSES]) response!: BannerResponse;
  /** Cualquier valor fuera de `bio|story|paid|dm` se guarda como `null` (no es error: C-B9). */
  @IsOptional() utmMedium?: unknown;
}

/**
 * QA M1: el pipe global de `main.ts` tiene `whitelist` SIN `forbidNonWhitelisted` (borraría `extra` en silencio ⇒ 204). Este
 * handler valida él mismo con `forbidNonWhitelisted`: una clave de más ⇒ 400 `VALIDATION_ERROR`. El parámetro se declara
 * `Record<string, unknown>` para que el pipe global NO lo toque (sin clase no valida ni recorta) y llegue el cuerpo tal cual.
 */
const STRICT_BODY = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

export const BANNER_RESPONSE_THROTTLE = { default: { ttl: 3_600_000, limit: 30 } } as const;

@Controller('measurement')
export class MeasurementController {
  constructor(private readonly banner: BannerResponseService) {}

  @Public()
  @Throttle(BANNER_RESPONSE_THROTTLE)
  @Post('banner-response')
  @HttpCode(204)
  async bannerResponse(@Body() body: Record<string, unknown>, @Headers('user-agent') userAgent?: string): Promise<void> {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('body sin forma');
    const dto = (await STRICT_BODY.transform(body, { type: 'body', metatype: BannerResponseDto, data: '' })) as BannerResponseDto;
    await this.banner.record(dto.response, dto.utmMedium, userAgent);
  }
}

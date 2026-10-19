/**
 * `POST /api/v1/measurement/banner-response` — público (API_CONTRACT §MKT.H.3). 204 siempre que el body tenga forma
 * válida (también con `MEASUREMENT_MODE=off`, sin escribir). 400 `VALIDATION_ERROR` sin forma; 429 a partir de 30/h por IP.
 */
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
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

export const BANNER_RESPONSE_THROTTLE = { default: { ttl: 3_600_000, limit: 30 } } as const;

@Controller('measurement')
export class MeasurementController {
  constructor(private readonly banner: BannerResponseService) {}

  @Public()
  @Throttle(BANNER_RESPONSE_THROTTLE)
  @Post('banner-response')
  @HttpCode(204)
  async bannerResponse(@Body() dto: BannerResponseDto, @Headers('user-agent') userAgent?: string): Promise<void> {
    await this.banner.record(dto.response, dto.utmMedium, userAgent);
  }
}

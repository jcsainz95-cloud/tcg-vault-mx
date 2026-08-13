import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthResult, HealthService } from './health.service';

/**
 * `GET /api/v1/health` — endpoint público para el healthcheck de la plataforma
 * (Railway `healthcheckPath`). Sin auth (`@Public()` salta el JwtAuthGuard global)
 * y sin rate-limit (`@SkipThrottle()`), para no gastar el cupo de sondas frecuentes.
 * 200 `{ status: 'ok', ... }` si las dependencias responden; 503 `{ status: 'degraded', ... }`
 * si Postgres (o Redis, cuando esté cableado) está caído.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<Omit<HealthResult, 'ok'>> {
    const { ok, ...body } = await this.health.check();
    res.status(ok ? 200 : 503);
    return body;
  }
}

/**
 * `POST /api/v1/admin/measurement/meta-test-event` — evento de prueba de Meta (API_CONTRACT §MKT.H.12; D-MKT2-10).
 *
 * 🔒 `@Roles(super_admin)` de clase (el `RolesGuard` de siempre): ⛔ no `marketing:read` ni `@Public()`. Otro rol ⇒ 403 antes
 * de leer el body. 200 `no-store` también si Meta rechaza (el diagnóstico es la respuesta). Body que no es objeto ⇒ 400;
 * forma ⇒ 422 (`details.field`); 409 sin Meta configurado; 429 con `Retry-After` = `details.retryAfterSeconds`.
 *
 * El parámetro se declara `Record<string, unknown>` para que el pipe global (whitelist) no lo toque: las claves de más
 * tienen que llegar al servicio y dar 422, no desaparecer en silencio.
 */
import { BadRequestException, Body, Controller, Header, HttpCode, Ip, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { MetaTestEventService } from './meta-test-event.service';
import type { MetaTestEventResult } from './meta-test-event';

@Controller('admin/measurement')
@Roles(Role.super_admin)
export class AdminMeasurementController {
  constructor(private readonly metaTest: MetaTestEventService) {}

  @Post('meta-test-event')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async metaTestEvent(
    @CurrentUser() user: { id: string; role?: Role },
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MetaTestEventResult> {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('body sin forma');
    try {
      return await this.metaTest.send(body, user, ip);
    } catch (err) {
      if (err instanceof BusinessException && err.code === 'RATE_LIMITED') {
        const seconds = Number(err.details.retryAfterSeconds);
        if (Number.isFinite(seconds) && seconds > 0) res.setHeader('Retry-After', String(seconds));
      }
      throw err;
    }
  }
}

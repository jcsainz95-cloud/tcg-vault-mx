import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { PostalCodeService } from './postal-code';

/**
 * `GET /api/v1/geo/postal-codes/:cp` (API_CONTRACT §M4-SHIP.19.5): público, 60/min por IP, cacheable un día.
 * Sirve la MISMA función con la que el servidor valida (`C-SDX-3`).
 */
@Controller('geo')
export class GeoController {
  constructor(private readonly postalCodes: PostalCodeService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', 'public, max-age=86400')
  @Get('postal-codes/:cp')
  postalCode(@Param('cp') cp: string) {
    return this.postalCodes.describe(cp);
  }
}

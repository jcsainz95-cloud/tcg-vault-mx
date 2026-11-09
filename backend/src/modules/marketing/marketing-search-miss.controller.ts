/**
 * `POST /api/v1/marketing/search-miss` — público (API_CONTRACT §MKT-V2; MKT_PANEL_V2 §7). `{ term ≤ 80, kind: 'card'|'sealed' }`.
 * `204` SIEMPRE (también con cuerpo inválido o si el filtro PII descarta el término): sin eco, sin identificador. El límite por IP
 * lo pone el throttler en memoria (la IP no se guarda).
 */
import { Body, Controller, HttpCode, Post, ValidationPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { MarketingSearchMissService } from './marketing-search-miss.service';

export class SearchMissDto {
  @IsString() @MaxLength(80) term!: string;
  @IsIn(['card', 'sealed']) kind!: 'card' | 'sealed';
}

const STRICT_BODY = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
export const SEARCH_MISS_THROTTLE = { default: { ttl: 60_000, limit: 30 } } as const;

@Controller('marketing')
export class MarketingSearchMissController {
  constructor(private readonly svc: MarketingSearchMissService) {}

  @Public()
  @Throttle(SEARCH_MISS_THROTTLE)
  @Post('search-miss')
  @HttpCode(204)
  async searchMiss(@Body() body: Record<string, unknown>): Promise<void> {
    try {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
      const dto = (await STRICT_BODY.transform(body, { type: 'body', metatype: SearchMissDto, data: '' })) as SearchMissDto;
      await this.svc.record(dto.term);
    } catch {
      /* 204 siempre: un cuerpo inválido no se explica */
    }
  }
}

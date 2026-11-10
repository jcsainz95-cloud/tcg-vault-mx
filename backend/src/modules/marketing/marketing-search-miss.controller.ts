/**
 * `POST /api/v1/marketing/search-miss` — público (API_CONTRACT §MKT-V2; MKT_PANEL_V2 §7). `{ term ≤ 80, kind: 'card'|'sealed' }`.
 * `204` SIEMPRE (también con cuerpo inválido, si el filtro descarta el término, se topa un límite o la BD falla; cuerpo > 1 KB ⇒ 413 en el parser): sin eco, sin identificador. El límite por IP
 * lo pone el throttler en memoria (la IP no se guarda).
 */
import { Body, Controller, HttpCode, Post, Req, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
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
  async searchMiss(@Body() body: Record<string, unknown>, @Req() req: Request): Promise<void> {
    try {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
      const dto = (await STRICT_BODY.transform(body, { type: 'body', metatype: SearchMissDto, data: '' })) as SearchMissDto;
      // IP y user-agent solo alimentan el hash del día (sal aleatoria, borrada al cierre); ⛔ no se guardan ni se registran.
      await this.svc.record(dto.term, { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) });
    } catch {
      /* 204 siempre: un cuerpo inválido no se explica */
    }
  }
}

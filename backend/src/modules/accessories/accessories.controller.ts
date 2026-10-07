/**
 * accessories.controller.ts — tienda pública de accesorios (API_CONTRACT §AC.3). Todas `@Public()`, sin sesión.
 *
 *  - `GET /accessories?category=&q=&page=&pageSize=`
 *  - `GET /accessories/suggestions?exclude=` — `Cache-Control: public, max-age=60` (declarada ANTES de `:id`).
 *  - `GET /accessories/:id`
 *  - `GET /accessories/:id/photo/:version/:variant` — `image/webp`, `Cache-Control: public, max-age=31536000, immutable`,
 *    `X-Content-Type-Options: nosniff` y `Cross-Origin-Resource-Policy: cross-origin` (la tienda vive en OTRO origen y
 *    `helmet()` pone `same-origin` por defecto: sin esto el navegador bloquearía el `<img>`; BACKEND_NOTES §83.A).
 */
import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AccessoriesService } from './accessories.service';

@Controller('accessories')
@Public()
export class AccessoriesController {
  constructor(private readonly svc: AccessoriesService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.svc.list(query);
  }

  @Get('suggestions')
  @Header('Cache-Control', 'public, max-age=60')
  suggestions(@Query('exclude') exclude: unknown) {
    return this.svc.suggestions(exclude);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Get(':id/photo/:version/:variant')
  async photo(@Param('id') id: string, @Param('version') version: string, @Param('variant') variant: string, @Res() res: Response) {
    const bytes = await this.svc.photo(id, version, variant);
    res
      .status(200)
      .set({
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .end(bytes);
  }
}

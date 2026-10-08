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

  // ⭐ `C-EQ-1` (BACKEND_NOTES §83.ceq1): un `@Query('…')` por llave, ⛔ no `@Query()` entero — el censo de §0-Q solo ve los
  // ejes con nombre, y `?category=` es un eje de dominio cerrado (clase E, `AccessoryCategory`). Las llaves desconocidas se
  // ignoraban antes y se siguen ignorando: la conducta no cambia.
  @Get()
  list(@Query('category') category?: string, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.list({ category, q, page, pageSize });
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

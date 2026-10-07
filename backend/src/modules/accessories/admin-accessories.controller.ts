/**
 * admin-accessories.controller.ts — panel `/admin/accessories` (API_CONTRACT §AC.11). Operador+ salvo ★ = `super_admin`
 * (activar, desactivar, borrar). Los campos ★ del cuerpo (precio, costo, «Sugerido») los rechaza el servicio con
 * `403 FORBIDDEN_FIELD {fields}`.
 *
 * Foto: `multipart/form-data`, campo `file`, límite de multer 10 MiB. ⛔ El `413` por defecto NO sale: pasarse ⇒
 * `422 PHOTO_INVALID {reason:'too_large'}`. Sin archivo ⇒ `400 VALIDATION_ERROR {field:'file'}`. El archivo vive en
 * memoria (nunca en disco) y el tipo lo decide la FIRMA de los bytes, no el `mimetype` ni la extensión.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { AdminAccessoriesService, Actor } from './admin-accessories.service';
import { PHOTO_MAX_BYTES, photoInvalid } from './accessory-photo';

// multer 2 no trae tipos y `@types/multer` no está instalado: se usa por `require` con la forma mínima que se toca.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require('multer') as {
  (opts: unknown): { single(field: string): (req: Request, res: Response, cb: (err?: unknown) => void) => void };
  memoryStorage(): unknown;
};

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 5, parts: 6 },
}).single('file');

function readPhoto(req: Request, res: Response): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    photoUpload(req, res, (err?: unknown) => {
      if (err) {
        const code = (err as { code?: string }).code;
        if (code === 'LIMIT_FILE_SIZE') return reject(photoInvalid('too_large'));
        return reject(BusinessException.badRequest('VALIDATION_ERROR', 'invalid multipart body', { field: 'file' }));
      }
      const file = (req as Request & { file?: { buffer?: Buffer } }).file;
      if (!file?.buffer) return reject(BusinessException.badRequest('VALIDATION_ERROR', 'file is required', { field: 'file' }));
      resolve(file.buffer);
    });
  });
}

@Controller('admin/accessories')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminAccessoriesController {
  constructor(private readonly svc: AdminAccessoriesService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: Actor) {
    return this.svc.list(query, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.get(id, user);
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.create(body, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.update(id, body, user);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Roles(Role.super_admin)
  activate(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.activate(id, user);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Roles(Role.super_admin)
  deactivate(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.deactivate(id, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.super_admin)
  async remove(@Param('id') id: string, @CurrentUser() user: Actor): Promise<void> {
    await this.svc.remove(id, user);
  }

  @Post(':id/photo')
  @HttpCode(200)
  async photo(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response, @CurrentUser() user: Actor) {
    const file = await readPhoto(req, res);
    return this.svc.replacePhoto(id, file, user);
  }

  @Post(':id/stock')
  @HttpCode(200)
  stock(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.stock(id, body, user);
  }

  @Get(':id/stock-movements')
  movements(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.svc.movements(id, query);
  }
}

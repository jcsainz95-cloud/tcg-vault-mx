import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessException } from '../../common/business.exception';
import { MAX_BODY_BYTES } from './card-show.constants';

/**
 * body-size.guard.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.11.v): el cuerpo de los POST de la
 * landing > 4 KB ⇒ `413 PAYLOAD_TOO_LARGE` (⛔ no silencioso). Corre ANTES de la validación del DTO.
 * Mide por `Content-Length`; si falta, mide los bytes del cuerpo ya parseado (red de respaldo).
 */
@Injectable()
export class CardShowBodySizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { body?: unknown }>();
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw this.tooLarge();
    if (req.body !== undefined) {
      const bytes = Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');
      if (bytes > MAX_BODY_BYTES) throw this.tooLarge();
    }
    return true;
  }

  private tooLarge(): BusinessException {
    return new BusinessException('PAYLOAD_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE, 'request body too large');
  }
}

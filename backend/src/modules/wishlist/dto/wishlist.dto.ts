/**
 * wishlist.dto.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.4 / §WSH.6). Cuerpos ESTRICTOS (D-WSH-6, criterio 801).
 *
 * ⚠️ **Por qué el pipe va en el PARÁMETRO y no en el controlador (medido, ver BACKEND_NOTES §84.2).** Nest ejecuta los pipes
 * en orden global → controlador → método → parámetro, y el global (`main.ts:54`, `whitelist: true`) ya entrega el cuerpo
 * SIN los campos desconocidos: un pipe estricto de controlador vería el objeto limpio y nunca rechazaría `maxPriceCents`.
 * Por eso el `@Body()` se declara con tipo `Record<string, unknown>` (el global no valida tipos que no son clase: pasa el
 * cuerpo crudo) y el pipe estricto de abajo valida contra la clase con `expectedType`.
 */
import { ArgumentMetadata, Injectable, PipeTransform, ValidationError, ValidationPipe } from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Finish } from '@prisma/client';
import { FINISH_VALUES } from '../../../common/enum-values';
import { BusinessException } from '../../../common/business.exception';
import { WISHLIST_PCTS, WishlistPct } from '../../../common/wishlist-math';

export class CreateWishlistItemDto {
  @IsString() @IsNotEmpty() @MaxLength(64) cardId!: string;
  @IsIn(FINISH_VALUES) finish!: Finish;
  @IsIn(WISHLIST_PCTS as unknown as number[]) maxPct!: WishlistPct;
}

export class UpdateWishlistItemDto {
  @IsIn(WISHLIST_PCTS as unknown as number[]) maxPct!: WishlistPct;
}

export class WishlistAlertsDto {
  @IsBoolean() paused!: boolean;
}

export class WishlistMailActionDto {
  @IsIn(['remove', 'pause']) action!: 'remove' | 'pause';
  @IsString() @IsNotEmpty() @MaxLength(64) id!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) token!: string;
}

/** El primer campo culpable: el desconocido (whitelist) o el inválido. */
function firstField(errors: ValidationError[]): string {
  const e = errors[0];
  return e?.property ?? 'body';
}

/** `400 VALIDATION_ERROR {field}` con `forbidNonWhitelisted` sobre la clase `T`. */
@Injectable()
export class StrictBodyPipe<T extends object> implements PipeTransform {
  private readonly pipe: ValidationPipe;

  constructor(private readonly type: new () => T) {
    this.pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      expectedType: type,
      exceptionFactory: (errors) =>
        BusinessException.badRequest('VALIDATION_ERROR', 'invalid request body', { field: firstField(errors) }),
    });
  }

  transform(value: unknown, metadata: ArgumentMetadata): Promise<T> {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid request body', { field: 'body' });
    }
    return this.pipe.transform(value, { ...metadata, metatype: this.type });
  }
}

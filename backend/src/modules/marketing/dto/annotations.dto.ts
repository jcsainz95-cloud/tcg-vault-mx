/**
 * annotations.dto.ts — forma del body/query del CRUD de anotaciones de fecha del Panel
 * (API_CONTRACT §MKT.E h1; ARCHITECTURE §13.4.6). La FORMA la valida el `ValidationPipe` global (400);
 * la PII y la coherencia `destino`⇄`kind` las valida el servicio (`422 VALIDATION_ERROR`, ver servicio).
 *
 * `kind` usa `@IsEnum(MarketingAnnotationKind)` (enum de Prisma, ⛔ sin lista literal — candado
 * `enum-values-parity`). Las cotas de longitud se aplican TRAS recortar espacios.
 */
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { MarketingAnnotationKind } from '@prisma/client';
import { BusinessException } from '../../../common/business.exception';

/** Recorta espacios ANTES de validar, para que la cota de longitud se aplique tras trim. */
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** `YYYY-MM-DD` (solo fecha, zona CDMX). El servidor la ancla a medianoche UTC para `@db.Date`. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAnnotationDto {
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsEnum(MarketingAnnotationKind)
  kind!: MarketingAnnotationKind;

  @trim()
  @IsString()
  @Length(1, 120)
  label!: string;

  @IsOptional()
  @trim()
  @IsString()
  @Length(1, 200)
  destino?: string;
}

export class UpdateAnnotationDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsEnum(MarketingAnnotationKind)
  kind?: MarketingAnnotationKind;

  @IsOptional()
  @trim()
  @IsString()
  @Length(1, 120)
  label?: string;

  // Permite BORRAR el destino con `""`/null al pasar a otro `kind` (el servicio normaliza a null).
  @IsOptional()
  @trim()
  @IsString()
  @Length(0, 200)
  destino?: string;
}

/**
 * `GET …/annotations?from=&to=` (v1.104, nota `CEQ-MKT-1`): ⛔ ya no hay DTO de query — cada llave se declara con
 * `@Query('from')`/`@Query('to')` en el controlador (un DTO esconde las llaves al descubrimiento de `C-EQ-1`). Misma
 * conducta que el `@IsOptional() @Matches(ISO_DATE)` de antes: ausente ⇒ sin cota; presente y fuera de forma
 * (incluida la cadena vacía) ⇒ `400 VALIDATION_ERROR`.
 */
export function parseAnnotationDay(field: 'from' | 'to', raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !ISO_DATE.test(raw)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, { field });
  }
  return raw;
}

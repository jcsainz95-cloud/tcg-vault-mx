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

/** Recorta espacios ANTES de validar, para que la cota de longitud se aplique tras trim. */
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** `YYYY-MM-DD` (solo fecha, zona CDMX). El servidor la ancla a medianoche UTC para `@db.Date`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

export class ListAnnotationsQueryDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

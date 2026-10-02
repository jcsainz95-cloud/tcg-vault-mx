/**
 * §M4-SHIP.15.4 / .15.5 / .15.10 — cuerpos del apartado «Por reponer». Validación de `400` por `class-validator`
 * (`whitelist` descarta llaves extra: un `basis` que llegue se ignora). ⛔ `amountCents` como cadena numérica ⇒ 400
 * (`IsInt` sin `transform` de tipo: el pipe global no convierte cadenas de un `@IsInt`).
 */
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ReplaceCaseDto {
  @IsString() @MinLength(1) inventoryItemId!: string;
  @IsOptional() @IsString() locationId?: string;
}

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CaseRefundDto {
  @IsInt() @Min(1) @Max(2147483647) amountCents!: number;
  @Transform(trimmed) @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsInt() @Min(0) expectedStripeCents!: number;
  @IsInt() @Min(0) expectedManualCents!: number;
  @IsOptional() @IsBoolean() confirmAboveReference?: boolean;
}

export class VoidCaseDto {
  @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(500) note!: string;
}

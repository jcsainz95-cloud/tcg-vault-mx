/**
 * §M4-SHIP.15.13 / .17.3 / .17.8 — cuerpos de la cubeta SPEI. Validación de `400` por `class-validator`
 * (`whitelist` descarta llaves extra). `speiReference` OPCIONAL (D-11): si viene, 1–30 `^[A-Za-z0-9]+$`.
 */
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ManualRefundPaidDto {
  @IsString() @MinLength(1) @MaxLength(128) revealToken!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) @Matches(/^[A-Za-z0-9]+$/) speiReference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsBoolean() confirmRecentClabeChange?: boolean;
  @IsOptional() @IsBoolean() confirmOriginNotSettled?: boolean;
}

export class ManualRefundNoteDto {
  @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

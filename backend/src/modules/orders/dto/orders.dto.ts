import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class QuoteDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
}

export class SessionDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) inventoryItemIds!: string[];
  @IsOptional() @IsString() billingProfileId?: string;
}

export class RefundDto {
  @IsString() reason!: string;
}

/**
 * v1.21.2 (§M3) — desenlace HUMANO de una pieza congelada por un contracargo con envío vivo.
 * `note` es OBLIGATORIA (3–500): es el registro de lo que el operador vio en el estante, y lo
 * único que queda como evidencia de por qué la carta volvió (o no) al inventario.
 */
export class ChargebackInventoryDto {
  @IsIn(['recuperada', 'no_recuperada', 'reexpedir'])
  outcome!: 'recuperada' | 'no_recuperada' | 'reexpedir';

  @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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
  /**
   * 💰 v1.80.5 (SEC-SHIP-B10, §M4-SHIP.18.4): en una orden `vault` con cartas ya en manos del cliente
   * (`already_withdrawn`) el reembolso total exige esta confirmación explícita ⇒ si no, `422
   * REFUND_CONFIRMATION_REQUIRED {required:['pieces_with_customer'], items}`.
   */
  @IsOptional() @IsBoolean() confirmPiecesWithCustomer?: boolean;
}

/** 🔒 v1.80.5/.6 (§M4-SHIP.18.10) — `POST /admin/orders/:id/reclaim-vault`. */
export class ReclaimVaultDto {
  @IsString() @MinLength(3) @MaxLength(500) note!: string;
  /** «Saqué de su caja las cartas de retiros preparados o con guía». */
  @IsOptional() @IsBoolean() confirmUnpacked?: boolean;
  /** v1.80.6 (SEC-SHIP-B12): acota `confirmUnpacked` a estas piezas (1–50; solo con `confirmUnpacked:true`). */
  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsString({ each: true }) inventoryItemIds?: string[];
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

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { GUEST_MAX_ITEMS } from '../guest-checkout.constants';

/**
 * DTOs del GUEST CHECKOUT (API_CONTRACT §4-G.1/.2/.3/.4/.9). Todo lo que falla aquí sale como
 * `400 VALIDATION_ERROR` (ValidationPipe global). Las reglas de NEGOCIO (país ≠ MX, destino
 * bóveda, correo con cuenta) NO se validan aquí: viven en el servicio, porque tienen códigos
 * propios (`422 ADDRESS_NOT_MX`, `422 VAULT_REQUIRES_ACCOUNT`) o no deben validarse en absoluto
 * (anti-enumeración: el checkout JAMÁS consulta `User`).
 */
export class GuestAddressInput {
  @IsString() @MaxLength(200) line1!: string;
  @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @IsOptional() @IsString() @MaxLength(120) neighborhood?: string;
  @IsString() @MaxLength(120) city!: string;
  @IsString() @MaxLength(120) state!: string;
  /** CP mexicano: exactamente 5 dígitos. */
  @Matches(/^\d{5}$/) postalCode!: string;
  /**
   * País: se acepta CUALQUIER string en la capa de validación a propósito, para que un país
   * distinto de "MX" salga como `422 ADDRESS_NOT_MX` (código del contrato) y no como un
   * `400 VALIDATION_ERROR` genérico. Solo nacional (PROJECT §D).
   */
  @IsString() @MaxLength(2) country!: string;
  /** Teléfono MX de contacto de paquetería: 10 dígitos. */
  @Matches(/^\d{10}$/) phone!: string;
  /** Quien recibe (el invitado no tiene `User.name`). */
  @IsString() @MaxLength(120) recipientName!: string;
}

export class GuestQuoteDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(GUEST_MAX_ITEMS)
  @IsString({ each: true })
  inventoryItemIds!: string[];

  /** Opcional en el quote (la tarifa es fija y nacional); si viene, se valida MX. */
  @IsOptional() @ValidateNested() @Type(() => GuestAddressInput) shippingAddress?: GuestAddressInput;
}

export class GuestSessionDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(GUEST_MAX_ITEMS)
  @IsString({ each: true })
  inventoryItemIds!: string[];

  /**
   * OBLIGATORIO (criterio 47). Formato RFC-5322 simplificado + ≤254. El `@Transform` recorta
   * espacios ANTES de validar porque el contrato manda normalizar (trim + lowercase) server-side:
   * un correo pegado con un espacio de sobra no puede bloquear una compra legítima. El lowercase
   * lo aplica el servicio (es la clave de comparación del reclamo).
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /**
   * OBLIGATORIA. `@IsDefined()` es imprescindible: `@ValidateNested()` a solas NO falla cuando el
   * valor es `undefined` (class-validator lo omite), y el pedido llegaría al servicio sin dirección.
   */
  @IsDefined()
  @ValidateNested()
  @Type(() => GuestAddressInput)
  shippingAddress!: GuestAddressInput;

  @IsOptional() @IsIn(['es', 'en']) locale?: 'es' | 'en';

  /** Aceptación explícita de ventas finales + aviso de privacidad. Debe ser literalmente `true`. */
  @IsBoolean() @Equals(true) acceptedTerms!: boolean;

  /** Si se envía DEBE ser `direct_ship`; `vault` → 422 VAULT_REQUIRES_ACCOUNT (upsell, no error). */
  @IsOptional() @IsIn(['vault', 'direct_ship']) fulfillmentMode?: 'vault' | 'direct_ship';
}

export class GuestTrackDto {
  /** El token viaja en el CUERPO (nunca en la ruta): fuera de access logs, `Referer` y cachés. */
  @IsString() @MaxLength(200) token!: string;
}

/**
 * Unión discriminada `{ token }` XOR `{ email, orderNumber }`. La exclusividad se comprueba en el
 * servicio (400 VALIDATION_ERROR si vienen ambas o ninguna): `email` SOLO nunca se acepta —pedir
 * además el número de pedido lo inutiliza como oráculo de "¿este correo compró aquí?".
 */
export class GuestResendLinkDto {
  @IsOptional() @IsString() @MaxLength(200) token?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @IsOptional() @IsString() @MaxLength(40) orderNumber?: string;
}

export class ClaimOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  orderIds!: string[];
}

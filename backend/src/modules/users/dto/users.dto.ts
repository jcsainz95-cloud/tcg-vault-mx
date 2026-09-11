import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

/** Recorta espacios ANTES de validar (el contrato manda `trim` server-side para nombres). */
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class UpdateMeDto {
  /**
   * v1.67 (contrato §1 `PATCH /users/me`, D-CTA-2): antes `@IsString()` a secas y aceptaba `""`.
   * Ahora: trim + string; la cota **1..120** y el `details.field='name'` los impone
   * `assertPersonName` en el servicio (ver `person-name.ts`). Al escribir `name` el servicio pone
   * `nameSource='user'` SIEMPRE (una key `nameSource` en el body la descarta el `whitelist`).
   */
  @IsOptional() @trim() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(['es', 'en']) locale?: 'es' | 'en';
}

export class AddressDto {
  /**
   * v1.67 (M-52, contrato §1 «Direcciones»): quien recibe en ESTA dirección. **OBLIGATORIO** al
   * crear; trim + 1..120 (`assertPersonName`). Misma forma que `GuestAddressInput.recipientName`.
   * El servidor NUNCA lo deriva de `User.name` (ARCHITECTURE §4.47.4).
   */
  @trim() @IsString() recipientName!: string;
  @IsString() @MinLength(1) line1!: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsString() @MinLength(1) city!: string;
  @IsString() @MinLength(1) state!: string;
  @IsString() @MinLength(3) postalCode!: string;
  @IsString() country!: string;
  @IsString() @MinLength(7) phone!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  /**
   * v1.67: opcional, **no vaciable**. `@IsOptional()` deja pasar `null` a propósito: el servicio lo
   * rechaza con `400 VALIDATION_ERROR details.field='recipientName'` (igual que `""`), en vez de
   * escribir `NULL` sobre una dirección que ya tenía destinatario. Es el remedio de
   * `422 RECIPIENT_NAME_REQUIRED`.
   */
  @IsOptional() @trim() @IsString() recipientName?: string;
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class BillingProfileDto {
  @IsString() rfc!: string;
  @IsString() razonSocial!: string;
  @IsString() regimenFiscal!: string;
  @IsString() usoCfdi!: string;
  @IsString() postalCode!: string;
  @IsEmail() email!: string;
}

export class UpdateKycDto {
  @IsOptional() @IsString() @Length(18, 18) clabe?: string;
  @IsOptional() @IsString() ineFrontUploadKey?: string;
  @IsOptional() @IsString() ineBackUploadKey?: string;
}

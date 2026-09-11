import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
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

/** Recorta y pasa a MAYÚSCULAS antes de validar (RFC, régimen y uso CFDI son códigos del SAT, no texto libre). */
const trimUpper = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));

/**
 * v1.67.1 (N2, techlead 2026-09-11): antes seis `@IsString()` pelados. Cotas y formato razonables,
 * SIN cambiar la forma del error (sigue el `400 VALIDATION_ERROR` del `ValidationPipe`):
 *  - `rfc`: 12 (moral) o 13 (física) caracteres, `[A-ZÑ&]{3,4}` + 6 dígitos de fecha + 3 de homoclave;
 *    se normaliza a mayúsculas (el front puede mandarlo en minúsculas). Se cifra en reposo (§3.4).
 *  - `razonSocial`: 1..254 (trim).
 *  - `regimenFiscal`: código SAT de 3 dígitos (`601`, `612`, `626`…).
 *  - `usoCfdi`: código SAT `G01`/`G03`/`P01`/`S01`/`CP01`/`CN01`/`D01`… (`[A-Z]{1,2}\d{2}`).
 *  - `postalCode`: 5 dígitos.
 *  - `email`: formato de correo, ≤ 254.
 */
export class BillingProfileDto {
  @trimUpper() @IsString() @Matches(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, { message: 'rfc must be a valid RFC (12-13 chars)' })
  rfc!: string;
  @trim() @IsString() @Length(1, 254) razonSocial!: string;
  @trimUpper() @IsString() @Matches(/^\d{3}$/, { message: 'regimenFiscal must be a 3-digit SAT code' })
  regimenFiscal!: string;
  @trimUpper() @IsString() @Matches(/^[A-Z]{1,2}\d{2}$/, { message: 'usoCfdi must be a SAT code like G03' })
  usoCfdi!: string;
  @trim() @IsString() @Matches(/^\d{5}$/, { message: 'postalCode must be 5 digits' }) postalCode!: string;
  @trim() @IsEmail() @MaxLength(254) email!: string;
}

export class UpdateKycDto {
  @IsOptional() @IsString() @Length(18, 18) clabe?: string;
  @IsOptional() @IsString() ineFrontUploadKey?: string;
  @IsOptional() @IsString() ineBackUploadKey?: string;
}

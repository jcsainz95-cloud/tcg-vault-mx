import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(['es', 'en']) locale?: 'es' | 'en';
}

export class AddressDto {
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

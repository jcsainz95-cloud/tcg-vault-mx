import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
// BE-9: la longitud mínima de contraseña vive en un solo sitio (compartida con admin.createUser).
import { MIN_PASSWORD_LENGTH } from '../../../common/validation/credentials';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class GoogleLoginDto {
  @IsString()
  @MinLength(1)
  idToken!: string;
}

// v1.5 — Verificación de correo + recuperación self-service.

export class VerifyEmailDto {
  @IsString()
  @MinLength(1)
  token!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // Misma política de contraseña que el registro (BE-9: constante compartida).
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;
}

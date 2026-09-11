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

// v1.67 (Stream A, contrato §1 «Cambiar la propia contraseña»): POST /auth/change-password.
export class ChangePasswordDto {
  // SIEMPRE obligatoria y no vacía (ARCHITECTURE §0-B.3 regla 9(c): la ausencia no compra una
  // garantía menor). Sin MinLength de política: es la que YA tiene, sea cual sea.
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  // MISMA constante que register y reset-password (BE-9). ⛔ Sin máximo ni complejidad propios.
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  newPassword!: string;
}

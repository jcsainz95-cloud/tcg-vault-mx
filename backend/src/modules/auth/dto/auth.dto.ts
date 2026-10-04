import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateBy, isEmail } from 'class-validator';
// BE-9: la longitud mínima de contraseña vive en un solo sitio (compartida con admin.createUser).
import { LOGIN_IDENTIFIER_MAX_LENGTH, MIN_PASSWORD_LENGTH } from '../../../common/validation/credentials';

/**
 * v1.80.9 (§M6-U.2/.3) — el campo `email` del login y de `forgot-password` es un IDENTIFICADOR: correo **o** nombre
 * de usuario. La llave NO se renombra (§4.58.3: front y back se publican sin orden garantizado).
 *  - string, `trim()` de 1–254 ⇒ si no, `400` estructural;
 *  - **con `@`** ⇒ es un correo: la MISMA validación de hoy (`@IsEmail` sobre el valor recibido) ⇒ un correo mal
 *    formado sigue siendo `400` (criterio 270: los clientes no notan nada);
 *  - **sin `@`** ⇒ es un usuario: ⛔ sin validar su forma (`"a b"` o `"José"` dan el `401` de siempre, no `400`:
 *    que el formato decidiera el código revelaría la regla, §4.58.3).
 */
export function isLoginIdentifier(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const t = value.trim();
  if (t.length < 1 || t.length > LOGIN_IDENTIFIER_MAX_LENGTH) return false;
  return value.includes('@') ? isEmail(value) : true;
}

export function IsLoginIdentifier() {
  return ValidateBy({
    name: 'isLoginIdentifier',
    validator: {
      validate: (value: unknown) => isLoginIdentifier(value),
      defaultMessage: () => 'email must be an email or a username',
    },
  });
}

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
  // v1.80.9: identificador (correo o usuario). Ver `isLoginIdentifier`.
  @IsLoginIdentifier()
  email!: string;

  @IsString()
  password!: string;

  // v1.80 (C7, contrato §1): el último `deviceToken` que recibió este navegador. Opcional; uno
  // ajeno, caducado o mal firmado se IGNORA sin error (lo decide `DeviceTokenService.verify`).
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  deviceToken?: string;
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
  // v1.80.9 (§M6-U.3): misma regla que el login. El servicio busca SOLO por `email` ⇒ un usuario nunca casa.
  @IsLoginIdentifier()
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

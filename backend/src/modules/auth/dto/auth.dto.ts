import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateBy, isEmail } from 'class-validator';
// BE-9: la longitud mínima de contraseña vive en un solo sitio (compartida con admin.createUser).
import { LOGIN_IDENTIFIER_MAX_LENGTH, MIN_PASSWORD_LENGTH, normalizeEmail } from '../../../common/validation/credentials';
import { Transform } from 'class-transformer';

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

/**
 * v1.117⟨cuenta-correo⟩ (§CTA.4) — `normalizeEmail` (trim + minúsculas) ANTES de `@IsEmail`: `"  Ana@X.COM "` valida y casa
 * con `ana@x.com` (CTA-B3). UN solo sitio de normalización para el alta y la corrección del correo: el servicio usa el valor
 * ya normalizado (⛔ no lo vuelve a normalizar: dos normalizaciones taparían que una desaparezca).
 */
export const NormalizedEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value));

/** `POST /auth/register/email-only` (§CTA.4): `{ email, locale? }`. ⛔ Sin `password`, `name` ni `phone` (los descarta el whitelist). */
export class RegisterEmailOnlyDto {
  @NormalizedEmail()
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';
}

/**
 * `POST /auth/account-setup` (§CTA.4): `{ token, name, password }`. `name` con trim; su cota 1..120 la impone
 * `assertPersonName` en el servicio ANTES de tocar el token (paso 1 normativo: un cuerpo inválido no quema el enlace).
 */
export class AccountSetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  name!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;
}

/** `POST /auth/set-password` (§CTA.4): `{ newPassword, name? }`. Mismas reglas que `account-setup`. */
export class SetPasswordDto {
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  newPassword!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  name?: string;
}

/** `PATCH /users/me/email` (§CTA.4): `{ email }`, misma validación y normalización que el alta. */
export class CorrectEmailDto {
  @NormalizedEmail()
  @IsEmail()
  email!: string;
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

/**
 * 🔒 v1.117.2 (API_CONTRACT §1 «Verificación de correo», D-CTA-12): `{ token, password }` **o** `{ token, newPassword }`,
 * exactamente uno. Los dos o ninguno ⇒ `400 VALIDATION_ERROR` en el pipe, ANTES de tocar el token. `newPassword` con la
 * política compartida (`MIN_PASSWORD_LENGTH`); `password` es la que YA tiene, sea cual sea (como `currentPassword`).
 */
const hasValue = (v: unknown) => v !== undefined && v !== null;

export class VerifyEmailDto {
  @IsString()
  @MinLength(1)
  @ValidateBy({
    name: 'exactlyOneCredential',
    validator: {
      validate: (_v: unknown, args) => {
        const o = (args?.object ?? {}) as { password?: unknown; newPassword?: unknown };
        return hasValue(o.password) !== hasValue(o.newPassword);
      },
      defaultMessage: () => 'exactly one of password or newPassword is required',
    },
  })
  token!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  newPassword?: string;
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

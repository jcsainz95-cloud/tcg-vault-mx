import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowPasswordChangeRequired } from '../../common/decorators/allow-password-change-required.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const HOUR_MS = 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // SEC-C1: registro público → límite estrecho por IP para frenar abuso/creación masiva.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // SEC-C1: login público sin lockout era el vector de toma de cuenta admin por fuerza
  // bruta. Se limita a 5 intentos/min por IP (los fallos también consumen cupo).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // v1.1: login/registro con Google (ID token verificado server-side). Mismo shape que /login.
  // Límite estrecho por IP (igual que /login) para frenar abuso.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('google')
  @HttpCode(200)
  google(@Body() dto: GoogleLoginDto) {
    return this.auth.google(dto.idToken);
  }

  // SEC-C1: refresh también público; límite algo más holgado para clientes legítimos.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // v1.67: en la allowlist de PASSWORD_CHANGE_REQUIRED (rendirse siempre se permite).
  @AllowPasswordChangeRequired()
  @Post('logout')
  @HttpCode(204)
  logout() {
    // JWT stateless: el cliente descarta los tokens. (Blacklist = fase 2.)
    return;
  }

  // v1.67 (Stream A · P-75, contrato §1 «Cambiar la propia contraseña»): AUTENTICADO, cualquier rol.
  // Rate-limit 5/min/IP (paridad con login: con una sesión robada es una superficie de adivinación
  // de la contraseña real). En la allowlist de PASSWORD_CHANGE_REQUIRED: es la salida.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @AllowPasswordChangeRequired()
  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto, @Ip() ip: string) {
    return this.auth.changePassword(userId, dto, ip);
  }

  // ---------------- v1.5: verificación de correo + recuperación self-service ----------------

  // AUTENTICADO (customer+): usa el email de la sesión (sin body → cero enumeración).
  // Rate-limit 3/h/usuario en servicio; backstop IP aquí. ARCHITECTURE §4.11.
  @Throttle({ default: { ttl: HOUR_MS, limit: 10 } })
  @Post('verify-email/resend')
  @HttpCode(200)
  resendVerification(@CurrentUser('id') userId: string, @Ip() ip: string) {
    return this.auth.resendVerification(userId, ip);
  }

  // Público (el link se abre desde el correo, quizá sin sesión). Rate-limit 10/min/IP.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  // Público. SIEMPRE 200 (anti-enumeración). Rate-limit 10/h/IP (+ tope por email en servicio).
  @Throttle({ default: { ttl: HOUR_MS, limit: 10 } })
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.auth.forgotPassword(dto.email, ip);
  }

  // Público. Consume el token de reset. Rate-limit 10/min/IP.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }
}

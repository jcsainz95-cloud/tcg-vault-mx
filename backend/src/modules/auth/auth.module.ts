import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleTokenVerifier } from './google-token-verifier';
import { AuthTokenService } from './auth-token.service';
import { MailModule } from '../mail/mail.module';
import { DeviceTokenService } from './device-token.service';
import { PasswordAttemptsService } from './password-attempts.service';
import { loginAttemptStoreProvider } from './login-attempt.store';

@Module({
  imports: [JwtModule.register({}), MailModule],
  // v1.80 (C7, §4.57): almacén de intentos (Redis + respaldo en memoria; memoria bajo la suite),
  // política y dispositivo conocido. `PasswordAttemptsService` se exporta para el reset por admin.
  providers: [
    AuthService,
    GoogleTokenVerifier,
    AuthTokenService,
    loginAttemptStoreProvider,
    PasswordAttemptsService,
    DeviceTokenService,
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, AuthTokenService, PasswordAttemptsService],
})
export class AuthModule {}

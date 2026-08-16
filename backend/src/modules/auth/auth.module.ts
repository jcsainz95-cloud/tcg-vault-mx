import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleTokenVerifier } from './google-token-verifier';
import { AuthTokenService } from './auth-token.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [JwtModule.register({}), MailModule],
  providers: [AuthService, GoogleTokenVerifier, AuthTokenService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, AuthTokenService],
})
export class AuthModule {}

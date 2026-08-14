import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleTokenVerifier } from './google-token-verifier';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, GoogleTokenVerifier],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

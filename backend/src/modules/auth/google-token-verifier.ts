import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { BusinessException } from '../../common/business.exception';

/** Identidad extraída de un ID token de Google ya verificado. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/**
 * GoogleTokenVerifier — verificación SERVER-SIDE del ID token de Google (ARCHITECTURE §4.7):
 * firma (JWKS de Google), `aud === GOOGLE_CLIENT_ID`, `iss` de Google y `exp` los valida
 * `OAuth2Client.verifyIdToken`. `email_verified` se devuelve para que el servicio decida
 * (403 GOOGLE_EMAIL_UNVERIFIED). NUNCA se lee `role`/privilegios del token.
 *
 * Es una clase inyectable delgada (fácil de mockear en tests). La verificación real hace
 * fetch de las llaves públicas de Google; en tests se sustituye por un doble.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name);
  private client?: OAuth2Client;

  constructor(private readonly config: ConfigService) {}

  private getClient(): OAuth2Client {
    if (!this.client) {
      this.client = new OAuth2Client(this.config.get<string>('GOOGLE_CLIENT_ID'));
    }
    return this.client;
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    const audience = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!audience) {
      // Sin GOOGLE_CLIENT_ID no podemos validar `aud`: se rechaza (nunca se acepta a ciegas).
      this.logger.error('GOOGLE_CLIENT_ID no configurado; no se puede verificar el ID token.');
      throw new BusinessException('GOOGLE_TOKEN_INVALID', 401, 'Google login not configured');
    }
    try {
      const ticket = await this.getClient().verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new BusinessException('GOOGLE_TOKEN_INVALID', 401, 'Invalid Google token');
      }
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      this.logger.warn(`Google ID token verification failed: ${(e as Error).message}`);
      throw new BusinessException('GOOGLE_TOKEN_INVALID', 401, 'Invalid Google token');
    }
  }
}

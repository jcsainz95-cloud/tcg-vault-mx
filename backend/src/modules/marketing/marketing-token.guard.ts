import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MarketingTokenService } from './marketing-token.service';

/**
 * MarketingApiTokenGuard — 🔒 autentica el principal de servicio `marketing-reader` (Brief 2 §7.2;
 * ARCHITECTURE §13.4.2). Se monta SOLO en `GET /admin/marketing/aggregates` (la ruta va @Public()
 * para saltar JwtAuthGuard; este guard la reautentica por token).
 *
 * - Lee `Authorization: Bearer <token>` (⛔ nunca de la URL/query; ⛔ nunca lo escribe en logs).
 * - Delega en el servicio: 401 (falta/ inválido/ revocado/ caducado) o 429 (IP bloqueada / 60/h).
 * - En éxito adjunta `req.marketingToken = { id, label }` (sin el claro ni el hash) para el access-log.
 */
@Injectable()
export class MarketingApiTokenGuard implements CanActivate {
  constructor(private readonly tokens: MarketingTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    const bearer = auth && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
    // IP del cliente (devops configura `trust proxy` en el borde; ver DEVOPS_NOTES). Sin IP ⇒ 'unknown'.
    const ip: string = req.ip || req.socket?.remoteAddress || 'unknown';
    req.marketingToken = await this.tokens.verify(bearer, ip);
    return true;
  }
}

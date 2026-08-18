import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { BusinessException } from '../../../common/business.exception';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * RejectAuthenticatedGuard — invariante §4-G.0-3: «un invitado nunca toca un endpoint `customer`
 * y viceversa». Los endpoints `/checkout/guest/*` son `@Public()` y además **rechazan** una sesión
 * válida con `409 ALREADY_AUTHENTICATED`.
 *
 * Por qué importa: sin esto, un usuario con cuenta podría comprar por la ruta de invitado y
 * generar un pedido `userId=null` con su correo — un pedido "huérfano" que su historial no vería,
 * que exigiría reclamo y que saltaría el `EmailVerifiedGuard` de `POST /checkout/session`. Un
 * endpoint, un tipo de comprador.
 *
 * Una sesión INVÁLIDA (token expirado, firma mala, cuenta bloqueada/borrada, `tokenVersion`
 * revocada) NO es una sesión: se deja pasar como invitado. Vive en `orders/` (no en
 * `common/guards/`, zona compartida de otro stream) y NO puebla `req.user`: el camino de invitado
 * no debe tener identidad.
 */
@Injectable()
export class RejectAuthenticatedGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers?.['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return true;

    let payload: { sub?: string; tv?: number };
    try {
      payload = await this.jwt.verifyAsync(auth.slice('Bearer '.length), {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      return true; // token inválido/expirado ⇒ no hay sesión ⇒ es un invitado.
    }
    if (!payload?.sub) return true;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tokenVersion: true },
    });
    const sessionIsValid =
      !!user &&
      user.status !== UserStatus.blocked &&
      user.status !== UserStatus.deleted &&
      (payload.tv ?? 0) === user.tokenVersion;

    if (sessionIsValid) {
      throw BusinessException.conflict(
        'ALREADY_AUTHENTICATED',
        'This endpoint is for guests only; use the authenticated checkout instead.',
      );
    }
    return true;
  }
}

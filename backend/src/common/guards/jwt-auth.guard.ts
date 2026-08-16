import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { BusinessException } from '../business.exception';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * JwtAuthGuard — Valida el access token (Bearer) y puebla `req.user`.
 * Las rutas marcadas @Public() se dejan pasar sin token.
 *
 * v1.3.1: además de la firma, verifica contra la BD que la cuenta siga activa y que el
 * `tokenVersion` del token coincida con el vigente. Así un reset de contraseña o un
 * soft-delete (que incrementan `User.tokenVersion`) REVOCAN de inmediato las sesiones vivas.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      throw BusinessException.validation('UNAUTHENTICATED', 'Missing bearer token');
    }
    const token = auth.slice('Bearer '.length);
    let payload: { sub: string; email?: string; role?: string; tv?: number };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        // S-B4: solo se acepta HS256 al verificar (evita algorithm-confusion).
        algorithms: ['HS256'],
      });
    } catch {
      throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid or expired token');
    }

    // Revocación por versión + estado de cuenta (reset/soft-delete/bloqueo).
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tokenVersion: true },
    });
    if (
      !user ||
      user.status === UserStatus.blocked ||
      user.status === UserStatus.deleted ||
      (payload.tv ?? 0) !== user.tokenVersion
    ) {
      throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid or revoked token');
    }

    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return true;
  }
}

/**
 * optional-session.guard.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.7 (b)). En una ruta `@Public()` el `JwtAuthGuard`
 * global deja pasar SIN leer el token, así que `@CurrentUser()` llegaba SIEMPRE vacío (medido: el alta del «avísame» nunca
 * recibía `userId`). Este guard, solo en las rutas que lo piden, puebla `req.user = { id }` cuando el Bearer es una sesión
 * VÁLIDA (mismas comprobaciones que el global: firma HS256, access sin `typ`, `tv` vigente, cuenta no bloqueada/borrada) y,
 * si no lo es, deja pasar como invitado. ⛔ Nunca rechaza: la ruta sigue siendo pública.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.user) return true;
    const auth: string | undefined = req.headers?.['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return true;
    let payload: { sub?: unknown; tv?: unknown; typ?: unknown; role?: unknown };
    try {
      payload = await this.jwt.verifyAsync(auth.slice('Bearer '.length), {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      return true;
    }
    if (payload.typ !== undefined || typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return true;
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tokenVersion: true, email: true, emailVerified: true },
    });
    if (!user || user.status === UserStatus.blocked || user.status === UserStatus.deleted || user.tokenVersion !== payload.tv) {
      return true;
    }
    req.user = { id: payload.sub, email: user.email, role: payload.role, hasEmail: user.email !== null, emailVerified: user.emailVerified };
    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, Prisma, Role, User, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { AuditService } from '../audit/audit.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { GoogleTokenVerifier } from './google-token-verifier';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly googleVerifier: GoogleTokenVerifier,
    private readonly audit: AuditService,
  ) {}

  private publicUser(u: User) {
    return { id: u.id, email: u.email, name: u.name, role: u.role, locale: u.locale };
  }

  async issueTokens(user: Pick<User, 'id' | 'email' | 'role'>): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    });
    const refreshToken = await this.jwt.signAsync(
      { ...payload, typ: 'refresh' },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_TTL') ?? '30d',
      },
    );
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const passwordHash = await argon2.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          name: dto.name,
          phone: dto.phone,
          locale: dto.locale ?? 'es',
          role: Role.customer,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw BusinessException.conflict('EMAIL_TAKEN', 'Email already registered');
      }
      throw e;
    }
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) {
      throw new BusinessException('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }
    // v1.1: una cuenta creada solo con Google tiene passwordHash=null; el login por
    // email/contraseña la RECHAZA con 401 (no revela que es cuenta Google) hasta que
    // el usuario fije contraseña. Se compara SIEMPRE contra un hash para no filtrar por
    // temporización si existe o no la cuenta/contraseña.
    if (!user.passwordHash) {
      throw new BusinessException('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) {
      throw new BusinessException('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }
    if (user.status === UserStatus.blocked) {
      throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
    }
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), ...tokens };
  }

  /**
   * Login/registro con ID token de Google (ARCHITECTURE §4.7, API_CONTRACT §auth/google).
   * Verifica el token server-side (aud/iss/exp/firma + email_verified). El `role` se asigna
   * SIEMPRE server-side (customer para altas nuevas); NUNCA se lee del token. Account-linking
   * por email verificado. Mismo shape de respuesta que /auth/login.
   */
  async google(idToken: string) {
    const identity = await this.googleVerifier.verify(idToken);
    // email_verified obligatorio: sin él no se crea NI se enlaza (evita apropiación de cuenta).
    if (!identity.emailVerified) {
      throw BusinessException.forbidden('GOOGLE_EMAIL_UNVERIFIED', 'Google email not verified');
    }
    const email = identity.email.toLowerCase();

    // 1) Por googleId (ya enlazada anteriormente).
    let user = await this.prisma.user.findUnique({ where: { googleId: identity.sub } });

    // 2) Account-linking por email verificado a una cuenta local existente.
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        if (byEmail.status === UserStatus.blocked) {
          throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: identity.sub,
            emailVerified: true,
            avatarUrl: byEmail.avatarUrl ?? identity.picture ?? null,
          },
        });
        await this.audit.log({
          actorUserId: user.id,
          actorRole: user.role,
          action: 'auth.google_link',
          entityType: 'User',
          entityId: user.id,
        });
      }
    }

    // 3) Alta nueva (solo-Google): passwordHash null, emailVerified true, role SIEMPRE customer.
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: null,
          name: identity.name ?? email.split('@')[0],
          role: Role.customer,
          authProvider: AuthProvider.google,
          googleId: identity.sub,
          emailVerified: true,
          avatarUrl: identity.picture ?? null,
        },
      });
    }

    if (user.status === UserStatus.blocked) {
      throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
    }
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), ...tokens };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status === UserStatus.blocked) {
        throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid refresh token');
      }
      return this.issueTokens(user);
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid or expired refresh token');
    }
  }
}

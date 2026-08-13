import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { RegisterDto, LoginDto } from './dto/auth.dto';

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

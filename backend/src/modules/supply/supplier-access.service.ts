import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { MIN_PASSWORD_LENGTH, normalizeEmail } from '../../common/validation/credentials';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { AuthService } from '../auth/auth.service';
import { hashAuthToken } from '../auth/auth-token.service';
import { AuditService } from '../audit/audit.service';
import { supplierInviteMail } from './supply-mail';
import { INVITE_TTL_MS } from './supply.constants';
import { AcceptInviteDto, InviteSupplierDto, PatchSupplierDto, pageOf } from './supply.dto';

@Injectable()
export class SupplierAccessService {
  private readonly logger = new Logger(SupplierAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  private link(token: string): string {
    const raw = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:3000';
    const origin = raw.split(',')[0].trim() || 'http://localhost:3000';
    return `${origin}/proveedores/activar?token=${encodeURIComponent(token)}`;
  }

  /** Emite (y rota) el enlace de un solo uso. Solo se guarda el hash. Devuelve el claro para el correo. */
  private async issueInvite(tx: Prisma.TransactionClient, supplierId: string, actorId: string): Promise<{ clear: string; expiresAt: Date }> {
    const clear = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await tx.supplierInvite.updateMany({ where: { supplierId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.supplierInvite.create({ data: { supplierId, tokenHash: hashAuthToken(clear), expiresAt, invitedById: actorId } });
    return { clear, expiresAt };
  }

  private async sendInvite(to: string, businessName: string, clear: string, reset: boolean): Promise<void> {
    try {
      const link = this.link(clear);
      const { subject, html, text } = supplierInviteMail(link, businessName, reset);
      await this.mail.send({ to, subject, html, text });
    } catch (e) {
      this.logger.error(`supplier invite mail failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async invite(dto: InviteSupplierDto, actorId: string): Promise<{ created: boolean; body: unknown }> {
    const email = normalizeEmail(dto.email);
    const existingSup = await this.prisma.supplier.findUnique({ where: { email } });
    if (existingSup && existingSup.status !== 'invited') throw BusinessException.conflict('EMAIL_TAKEN', 'Email already in use');
    if (!existingSup) {
      const u = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (u) throw BusinessException.conflict('EMAIL_TAKEN', 'Email already in use');
    }
    const { supplier, clear, expiresAt } = await this.prisma.$transaction(async (tx) => {
      const sup = existingSup
        ? await tx.supplier.update({ where: { id: existingSup.id }, data: { businessName: dto.businessName, phone: dto.phone ?? existingSup.phone } })
        : await tx.supplier.create({ data: { email, businessName: dto.businessName, phone: dto.phone ?? null } });
      const inv = await this.issueInvite(tx, sup.id, actorId);
      return { supplier: sup, ...inv };
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw BusinessException.conflict('EMAIL_TAKEN', 'Email already in use');
      throw e;
    });
    await this.audit.log({ actorUserId: actorId, actorRole: Role.super_admin, action: 'supplier.invite', entityType: 'Supplier', entityId: supplier.id });
    await this.sendInvite(email, supplier.businessName, clear, false);
    return {
      created: !existingSup,
      body: { supplier: { id: supplier.id, businessName: supplier.businessName, email, status: 'invited' }, inviteExpiresAt: expiresAt },
    };
  }

  async acceptInvite(dto: AcceptInviteDto) {
    if (dto.password.length < MIN_PASSWORD_LENGTH) throw BusinessException.badRequest('WEAK_PASSWORD', 'Password too short');
    const invite = await this.prisma.supplierInvite.findUnique({ where: { tokenHash: hashAuthToken(dto.token) }, include: { supplier: true } });
    if (!invite || invite.usedAt) throw BusinessException.badRequest('INVITE_INVALID', 'Invalid invite');
    if (invite.expiresAt.getTime() <= Date.now()) throw new BusinessException('INVITE_EXPIRED', 410, 'Invite expired');
    const passwordHash = await argon2.hash(dto.password);
    const sup = invite.supplier;
    const user = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.supplierInvite.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claim.count !== 1) throw BusinessException.badRequest('INVITE_INVALID', 'Invalid invite');
      if (sup.userId) {
        // Restablecimiento de contraseña de una cuenta ya existente: revoca sesiones vivas.
        const reset = await tx.user.update({ where: { id: sup.userId }, data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false } });
        return reset;
      }
      const u = await tx.user.create({
        data: { email: sup.email, passwordHash, role: Role.supplier, name: sup.businessName, emailVerified: true, locale: 'es' },
      });
      await tx.supplier.update({ where: { id: sup.id }, data: { userId: u.id, status: 'active', activatedAt: new Date() } });
      return u;
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw BusinessException.conflict('EMAIL_TAKEN', 'Email already in use');
      throw e;
    });
    const tokens = await this.auth.issueTokens(user);
    return {
      user: {
        id: user.id, email: user.email, username: user.username, name: user.name, role: user.role, locale: user.locale,
        emailVerified: user.emailVerified, mustChangePassword: user.mustChangePassword, supplierName: sup.businessName,
      },
      ...tokens,
    };
  }

  async me(userId: string) {
    const s = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!s) throw BusinessException.notFound();
    return { id: s.id, businessName: s.businessName, email: s.email, phone: s.phone, status: s.status };
  }

  async list(q: { q?: string; status?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip } = pageOf(q);
    const where: Prisma.SupplierWhereInput = {};
    if (q.status && ['invited', 'active', 'suspended'].includes(q.status)) where.status = q.status as 'invited';
    if (q.q?.trim()) where.OR = [{ businessName: { contains: q.q.trim(), mode: 'insensitive' } }, { email: { contains: q.q.trim(), mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, include: { _count: { select: { offers: { where: { status: { in: ['open', 'countered'] } } } } } } }),
      this.prisma.supplier.count({ where }),
    ]);
    return {
      data: rows.map((s) => ({
        id: s.id, businessName: s.businessName, email: s.email, phone: s.phone, status: s.status,
        createdAt: s.createdAt, activatedAt: s.activatedAt, openOffers: s._count.offers,
      })),
      page, pageSize, total,
    };
  }

  async patch(id: string, dto: PatchSupplierDto, actorId: string) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw BusinessException.notFound();
    if (dto.status === 'active' && s.status === 'invited') throw BusinessException.conflict('INVALID_STATE', 'Invited suppliers activate by accepting the invite');
    if (dto.status === 'suspended' && s.status === 'invited') throw BusinessException.conflict('INVALID_STATE', 'Supplier has not activated yet');
    if (dto.resetPassword && !s.userId) throw BusinessException.conflict('INVALID_STATE', 'Supplier has not activated yet');
    const data: Prisma.SupplierUpdateInput = {};
    if (dto.businessName !== undefined) data.businessName = dto.businessName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.status !== undefined) data.status = dto.status;
    let clear: string | undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.supplier.update({ where: { id }, data });
      // Suspender revoca sesiones (access y refresh) por la palanca de siempre: tokenVersion + 1.
      if (dto.status === 'suspended' && s.userId) await tx.user.update({ where: { id: s.userId }, data: { tokenVersion: { increment: 1 } } });
      if (dto.resetPassword) clear = (await this.issueInvite(tx, id, actorId)).clear;
      return u;
    });
    await this.audit.log({ actorUserId: actorId, actorRole: Role.super_admin, action: 'supplier.patch', entityType: 'Supplier', entityId: id, after: { status: dto.status, resetPassword: !!dto.resetPassword } });
    if (clear) await this.sendInvite(updated.email, updated.businessName, clear, true);
    return { id: updated.id, businessName: updated.businessName, email: updated.email, phone: updated.phone, status: updated.status };
  }
}

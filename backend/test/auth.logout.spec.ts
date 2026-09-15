import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthTokenService } from '../src/modules/auth/auth-token.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

/**
 * v1.71 (SEC-CR-1) — `AuthService.logout`. Cerrar sesión REVOCA todas las sesiones de la cuenta vía
 * `tokenVersion +1` (decisión del dueño 2026-09-14; palanca por-persona, no por-dispositivo). Antes
 * `logout()` era `return;` (no-op): el hallazgo de `seguridad` medía que un testigo copiado seguía
 * dando 200 tras logout. Este unit fija: UNA escritura `tokenVersion:{increment:1}` sobre el userId
 * de la sesión, auditoría `auth.logout` sin secretos, y NO emite tokens (logout no re-loguea).
 */
const config = new ConfigService({
  JWT_ACCESS_SECRET: 'unit_access_secret',
  JWT_REFRESH_SECRET: 'unit_refresh_secret',
});
const google = {} as unknown as GoogleTokenVerifier;
const tokens = {} as unknown as AuthTokenService;
const mail = {} as unknown as MailService;

function make() {
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'u1',
    role: 'vault_operator',
    tokenVersion: 8,
    ...data,
  }));
  const prisma = { user: { update } };
  const audit = { log: jest.fn(async () => undefined) };
  const signAsync = jest.fn(async () => 'tok');
  const svc = new AuthService(
    prisma as unknown as PrismaService,
    { signAsync } as unknown as JwtService,
    config,
    google,
    audit as unknown as AuditService,
    tokens,
    mail,
  );
  return { svc, update, audit, signAsync };
}

describe('AuthService.logout — revocación por tokenVersion (SEC-CR-1)', () => {
  it('UNA escritura: tokenVersion +1 sobre el userId de la sesión; devuelve void', async () => {
    const { svc, update } = make();
    const res = await svc.logout('u1');
    expect(res).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    const { where, data } = update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(where).toEqual({ id: 'u1' });
    expect(data).toEqual({ tokenVersion: { increment: 1 } });
  });

  it('audita auth.logout (User, actor = el propio usuario, con su rol) y NO emite tokens', async () => {
    const { svc, audit, signAsync } = make();
    await svc.logout('u1');
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect((audit.log as jest.Mock).mock.calls[0][0]).toMatchObject({
      actorUserId: 'u1',
      actorRole: 'vault_operator',
      action: 'auth.logout',
      entityType: 'User',
      entityId: 'u1',
    });
    // Cerrar sesión no re-loguea: no se firma ningún JWT.
    expect(signAsync).not.toHaveBeenCalled();
  });
});

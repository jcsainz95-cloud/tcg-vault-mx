import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { AdminUsersController } from '../src/modules/admin/admin.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * E2 (v1.7-admin-users, API_CONTRACT §M6 / ARCHITECTURE §4.7bis) — alta de usuarios por rol
 * desde admin. Valida: creación por rol, lowercasing de email, emailVerified=true,
 * authProvider=local, autogen de password (tempPassword una vez + mustChangePassword=true),
 * password provista (mustChangePassword=false, sin tempPassword), 422 semánticos, 409 duplicado,
 * y que la contraseña NUNCA entra al AuditLog.
 */
const pii = new PiiCryptoService(new ConfigService({}));

function svc(prisma: any) {
  return new AdminService(
    prisma as PrismaService,
    {} as PricingService,
    pii,
    { deleteObject: jest.fn() } as any,
  );
}

function prismaCreate(): any {
  return {
    user: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'new-id',
        email: data.email,
        name: data.name,
        role: data.role,
        locale: data.locale,
        status: 'active',
        emailVerified: data.emailVerified,
        authProvider: data.authProvider,
        mustChangePassword: data.mustChangePassword,
        passwordHash: data.passwordHash,
        createdAt: new Date('2026-08-16T00:00:00Z'),
      })),
    },
  };
}

describe('AdminService.createUser', () => {
  it.each(['customer', 'vault_operator', 'super_admin'])(
    'crea %s OK con password provista: emailVerified=true, authProvider=local, sin passwordHash en la respuesta, mustChangePassword=false',
    async (role) => {
      const prisma = prismaCreate();
      const res = await svc(prisma).createUser({
        email: 'NewUser@Example.com',
        name: 'New User',
        role,
        password: 'password123',
      });

      expect(res.user.role).toBe(role);
      // email lowercaseado (paridad con /auth/register).
      expect(res.user.email).toBe('newuser@example.com');
      expect(res.user.emailVerified).toBe(true);
      expect(res.user.authProvider).toBe('local');
      expect(res.user.status).toBe('active');
      expect(res.user.locale).toBe('es');
      // shape público: sin passwordHash.
      expect((res.user as Record<string, unknown>).passwordHash).toBeUndefined();
      // password provista → mustChangePassword=false + NO tempPassword.
      expect(res.mustChangePassword).toBe(false);
      expect(res.tempPassword).toBeUndefined();

      // Persiste el HASH argon2 (nunca el claro) y corresponde a la provista.
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.passwordHash).toMatch(/^\$argon2/);
      await expect(argon2.verify(data.passwordHash, 'password123')).resolves.toBe(true);
      expect(data.emailVerified).toBe(true);
      expect(data.authProvider).toBe('local');
      expect(data.mustChangePassword).toBe(false);
    },
  );

  it('autogenera la password si se omite: devuelve tempPassword UNA vez + mustChangePassword=true', async () => {
    const prisma = prismaCreate();
    const res = await svc(prisma).createUser({
      email: 'temp@example.com',
      name: 'Temp',
      role: 'vault_operator',
    });

    expect(typeof res.tempPassword).toBe('string');
    expect(res.tempPassword!.length).toBeGreaterThanOrEqual(16);
    expect(res.mustChangePassword).toBe(true);

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(true);
    // El hash persistido corresponde a la temp devuelta (alta entropía, argon2).
    expect(data.passwordHash).toMatch(/^\$argon2/);
    await expect(argon2.verify(data.passwordHash, res.tempPassword!)).resolves.toBe(true);
  });

  it('locale explícito se respeta (en)', async () => {
    const prisma = prismaCreate();
    const res = await svc(prisma).createUser({
      email: 'l@example.com',
      name: 'L',
      role: 'customer',
      password: 'password123',
      locale: 'en',
    });
    expect(res.user.locale).toBe('en');
  });

  it('rol inválido → 422 VALIDATION_ERROR (no llama a create)', async () => {
    const prisma = prismaCreate();
    await expect(
      svc(prisma).createUser({ email: 'a@x.com', name: 'N', role: 'root', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // status 422
    await svc(prisma)
      .createUser({ email: 'a@x.com', name: 'N', role: 'root', password: 'password123' })
      .catch((e) => expect(e.getStatus()).toBe(422));
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('email inválido → 422', async () => {
    const prisma = prismaCreate();
    await expect(
      svc(prisma).createUser({ email: 'not-an-email', name: 'N', role: 'customer', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('password provista débil (<8) → 422', async () => {
    const prisma = prismaCreate();
    await expect(
      svc(prisma).createUser({ email: 'a@x.com', name: 'N', role: 'customer', password: 'short' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('name vacío → 422', async () => {
    const prisma = prismaCreate();
    await expect(
      svc(prisma).createUser({ email: 'a@x.com', name: '   ', role: 'customer', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('locale inválido → 422', async () => {
    const prisma = prismaCreate();
    await expect(
      svc(prisma).createUser({ email: 'a@x.com', name: 'N', role: 'customer', password: 'password123', locale: 'fr' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('email duplicado (P2002) → 409 EMAIL_TAKEN', async () => {
    const prisma = {
      user: {
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '5.22.0',
          }),
        ),
      },
    };
    await expect(
      svc(prisma).createUser({ email: 'a@x.com', name: 'N', role: 'customer', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});

describe('AdminUsersController.createUser — auditoría sin filtrar la contraseña', () => {
  it('audita user.create sin la contraseña (temp ni provista) y devuelve tempPassword al llamador', async () => {
    const created = {
      user: {
        id: 'u1',
        email: 'a@x.com',
        name: 'N',
        role: 'vault_operator',
        locale: 'es',
        status: 'active',
        emailVerified: true,
        authProvider: 'local',
        createdAt: new Date(),
      },
      tempPassword: 'SUPER-SECRET-TEMP',
      mustChangePassword: true,
    };
    const adminMock: any = { createUser: jest.fn(async () => created) };
    const auditMock: any = { log: jest.fn(async () => undefined) };
    const ctrl = new AdminUsersController(adminMock as any, auditMock as any);

    const res = await ctrl.createUser(
      { email: 'a@x.com', name: 'N', role: 'vault_operator' } as any,
      { id: 'admin', role: 'super_admin' } as any,
    );

    // La tempPassword se devuelve UNA vez al súper-admin.
    expect(res.tempPassword).toBe('SUPER-SECRET-TEMP');

    // La bitácora registra el hecho pero NUNCA la contraseña temporal.
    const logArg = auditMock.log.mock.calls[0][0];
    expect(logArg.action).toBe('user.create');
    expect(logArg.entityType).toBe('User');
    expect(logArg.entityId).toBe('u1');
    expect(logArg.after).toEqual({
      role: 'vault_operator',
      emailVerified: true,
      authProvider: 'local',
      mustChangePassword: true,
    });
    // Serialización defensiva: el valor de la temp no aparece en ningún lado del log.
    expect(JSON.stringify(logArg)).not.toContain('SUPER-SECRET-TEMP');
    expect(logArg.before).toBeUndefined();
  });
});

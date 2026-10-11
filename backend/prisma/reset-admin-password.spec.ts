/**
 * SEC-RESET-TV (seguridad, Media, 2026-09-28): el script de rescate de contraseña de staff debe
 * REVOCAR las sesiones vivas (`tokenVersion +1`) en la MISMA escritura que cambia el hash. Si se usa
 * porque la cuenta está comprometida, un refresh token robado no puede seguir valiendo 30 días.
 *
 * No toca BD: Prisma y el hasher se inyectan. Importar el módulo NO ejecuta main().
 */
import { resetStaffPassword, ResetPrismaLike, MIN_PASSWORD_LENGTH } from './reset-admin-password';

const GOOD = 'x'.repeat(MIN_PASSWORD_LENGTH);

function fakePrisma(role: string | null) {
  const update = jest.fn().mockResolvedValue({});
  const findUnique = jest
    .fn()
    .mockResolvedValue(role === null ? null : { email: 'admin@tcg.local', role });
  const prisma: ResetPrismaLike = { user: { findUnique, update } };
  return { prisma, update, findUnique };
}

const fakeHash = async (plain: string) => `hashed(${plain.length})`;

describe('reset-admin-password · SEC-RESET-TV', () => {
  it.each(['super_admin', 'vault_operator'])(
    '%s: UNA sola escritura con hash nuevo + tokenVersion incrementado (revoca sesiones)',
    async (role) => {
      const { prisma, update } = fakePrisma(role);
      await resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: GOOD }, fakeHash);

      // Atómico: una única escritura; nada de un segundo update que pueda no ocurrir.
      expect(update).toHaveBeenCalledTimes(1);
      const { where, data } = update.mock.calls[0][0];
      expect(where).toEqual({ email: 'admin@tcg.local' });
      expect(data).toEqual({
        passwordHash: `hashed(${GOOD.length})`,
        tokenVersion: { increment: 1 },
        emailVerified: true,
        mustChangePassword: false,
      });
    },
  );

  it('ADMIN_EMAIL gana sobre SEED_ADMIN_EMAIL', async () => {
    const { prisma, findUnique, update } = fakePrisma('super_admin');
    await resetStaffPassword(
      prisma,
      { NEW_ADMIN_PASSWORD: GOOD, ADMIN_EMAIL: 'a@x.mx', SEED_ADMIN_EMAIL: 's@x.mx' },
      fakeHash,
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'a@x.mx' } });
    expect(update.mock.calls[0][0].where).toEqual({ email: 'a@x.mx' });
  });

  it('se niega sin contraseña o con una corta, sin escribir', async () => {
    for (const pw of [undefined, 'x'.repeat(MIN_PASSWORD_LENGTH - 1)]) {
      const { prisma, update, findUnique } = fakePrisma('super_admin');
      await expect(resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: pw }, fakeHash)).rejects.toThrow(
        /NEW_ADMIN_PASSWORD is required/,
      );
      expect(findUnique).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('se niega con cuenta inexistente o no staff, sin escribir', async () => {
    const missing = fakePrisma(null);
    await expect(
      resetStaffPassword(missing.prisma, { NEW_ADMIN_PASSWORD: GOOD }, fakeHash),
    ).rejects.toThrow(/No user found/);
    expect(missing.update).not.toHaveBeenCalled();

    const customer = fakePrisma('customer');
    await expect(
      resetStaffPassword(customer.prisma, { NEW_ADMIN_PASSWORD: GOOD }, fakeHash),
    ).rejects.toThrow(/Refusing to reset/);
    expect(customer.update).not.toHaveBeenCalled();
  });

  it('nunca devuelve la contraseña', async () => {
    const { prisma } = fakePrisma('super_admin');
    const out = await resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: GOOD }, fakeHash);
    expect(out).toEqual({ email: 'admin@tcg.local', role: 'super_admin' });
    expect(JSON.stringify(out)).not.toContain(GOOD);
  });
});

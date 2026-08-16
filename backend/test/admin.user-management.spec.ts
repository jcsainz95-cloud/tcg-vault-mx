import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * v1.3.1 (M6, API_CONTRACT §M6 / ARCHITECTURE §4.7bis) — gestión de usuarios por admin:
 *  - reset de contraseña sin correo: temp segura hasheada con argon2, revoca sesiones
 *    (tokenVersion++), fuerza cambio, NUNCA loguea/persiste la contraseña en claro.
 *  - borrado híbrido: HARD sin historial económico, SOFT con historial (anonimiza PII),
 *    409 al auto-borrarse, idempotente sobre cuentas ya soft-deleted.
 */
const pii = new PiiCryptoService(new ConfigService({}));

function svc(prisma: any, uploads: any = { deleteObject: jest.fn() }) {
  return new AdminService(prisma as PrismaService, {} as PricingService, pii, uploads);
}

describe('AdminService.resetPassword', () => {
  it('genera temp, la hashea con argon2, revoca sesiones y fuerza cambio (sin exponer claro)', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'active' }),
        update: jest.fn(async () => ({})),
      },
    };
    const res = await svc(prisma).resetPassword('u1');

    expect(res.userId).toBe('u1');
    expect(res.mustChangePassword).toBe(true);
    expect(typeof res.tempPassword).toBe('string');
    expect(res.tempPassword.length).toBeGreaterThanOrEqual(16);

    const data = prisma.user.update.mock.calls[0][0].data;
    // Persiste el HASH, nunca la contraseña en claro.
    expect(data.passwordHash).toMatch(/^\$argon2/);
    expect(data.passwordHash).not.toBe(res.tempPassword);
    // El hash corresponde a la temp devuelta (verificable con argon2).
    await expect(argon2.verify(data.passwordHash, res.tempPassword)).resolves.toBe(true);
    // Revoca sesiones vivas + fuerza cambio.
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.mustChangePassword).toBe(true);
  });

  it('cuenta ya soft-deleted → 422 USER_DELETED', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'deleted' }), update: jest.fn() },
    };
    await expect(svc(prisma).resetPassword('u1')).rejects.toMatchObject({ code: 'USER_DELETED' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('usuario inexistente → NOT_FOUND', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    await expect(svc(prisma).resetPassword('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('AdminService.deleteUser — híbrido hard/soft', () => {
  function prismaWith(opts: {
    user: any;
    counts?: Partial<Record<'order' | 'sellRequest' | 'shipmentRequest' | 'dispute' | 'inventoryItem', number>>;
  }) {
    const c = opts.counts ?? {};
    const tx = {
      kycProfile: { update: jest.fn(async () => ({})) },
      billingProfile: { deleteMany: jest.fn(async () => ({})) },
      address: { deleteMany: jest.fn(async () => ({})) },
      portfolioSnapshot: { deleteMany: jest.fn(async () => ({})) },
      user: { update: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(opts.user),
        delete: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      order: { count: jest.fn(async () => c.order ?? 0) },
      sellRequest: { count: jest.fn(async () => c.sellRequest ?? 0) },
      shipmentRequest: { count: jest.fn(async () => c.shipmentRequest ?? 0) },
      dispute: { count: jest.fn(async () => c.dispute ?? 0) },
      inventoryItem: { count: jest.fn(async () => c.inventoryItem ?? 0) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    return { prisma, tx };
  }

  it('409 CANNOT_DELETE_SELF si el actor se borra a sí mismo', async () => {
    const { prisma } = prismaWith({ user: { id: 'admin', status: 'active' } });
    await expect(svc(prisma).deleteUser('admin', 'admin')).rejects.toMatchObject({
      code: 'CANNOT_DELETE_SELF',
    });
  });

  it('SIN historial económico → HARD delete (cascada) + purga INE', async () => {
    const { prisma } = prismaWith({
      user: { id: 'u1', status: 'active', kycProfile: { id: 'k', ineFrontKey: 'ine/f', ineBackKey: 'ine/b' } },
      counts: {},
    });
    const uploads = { deleteObject: jest.fn(async () => undefined) };
    const res = await svc(prisma, uploads).deleteUser('u1', 'admin');
    expect(res).toEqual({ userId: 'u1', mode: 'hard' });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    // Purgó ambas imágenes de INE del storage.
    expect(uploads.deleteObject).toHaveBeenCalledWith('ine/f');
    expect(uploads.deleteObject).toHaveBeenCalledWith('ine/b');
    // No entró al camino soft.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('CON historial económico → SOFT delete: anonimiza PII, conserva filas, revoca login', async () => {
    const { prisma, tx } = prismaWith({
      user: { id: 'u1', status: 'active', kycProfile: { id: 'k', ineFrontKey: 'ine/f', ineBackKey: null } },
      counts: { order: 2 },
    });
    const res = await svc(prisma).deleteUser('u1', 'admin');
    expect(res).toEqual({ userId: 'u1', mode: 'soft' });
    // No hard-delete.
    expect(prisma.user.delete).not.toHaveBeenCalled();
    // Anonimización de la cuenta.
    const userData = (tx.user.update as jest.Mock).mock.calls[0][0].data;
    expect(userData.status).toBe('deleted');
    expect(userData.email).toMatch(/^deleted\+.*@anon\.invalid$/);
    expect(userData.name).toBe('Usuario eliminado');
    expect(userData.passwordHash).toBeNull();
    expect(userData.googleId).toBeNull();
    expect(userData.tokenVersion).toEqual({ increment: 1 });
    expect(userData.deletedAt).toBeInstanceOf(Date);
    expect(userData.anonymizedAt).toBeInstanceOf(Date);
    // PII sensible borrada; filas económicas NO se tocan (no hay order.delete).
    const kycData = (tx.kycProfile.update as jest.Mock).mock.calls[0][0].data;
    expect(kycData).toMatchObject({ clabeEnc: null, clabeHmac: null, rfcEnc: null, legalName: null, ineFrontKey: null, ineBackKey: null });
    expect(tx.billingProfile.deleteMany).toHaveBeenCalled();
    expect(tx.address.deleteMany).toHaveBeenCalled();
  });

  it('re-DELETE sobre cuenta ya soft-deleted → no-op idempotente { mode: "soft" }', async () => {
    const { prisma } = prismaWith({ user: { id: 'u1', status: 'deleted', kycProfile: null }, counts: { order: 2 } });
    const res = await svc(prisma).deleteUser('u1', 'admin');
    expect(res).toEqual({ userId: 'u1', mode: 'soft' });
    // No recomputa nada ni vuelve a borrar.
    expect(prisma.order.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('usuario inexistente → NOT_FOUND', async () => {
    const { prisma } = prismaWith({ user: null });
    await expect(svc(prisma).deleteUser('nope', 'admin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

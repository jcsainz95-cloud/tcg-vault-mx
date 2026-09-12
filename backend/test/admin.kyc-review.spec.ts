import { KycStatus, Role } from '@prisma/client';
import { AdminUsersController } from '../src/modules/admin/admin.controller';
import { AdminService } from '../src/modules/admin/admin.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * ⭐ **v1.69 (P-78, BK-2) — verificar y rechazar CON MOTIVO.**
 * API_CONTRACT §M6-K.4 (candado **K-5**) · §M6-K.7 · ARCHITECTURE §4.49.3 (M-54).
 *
 * El defecto que cierra, dicho entero: hasta v1.68.1 el selector de M6 movía `kycStatus` **sin
 * motivo y sin sello de quién decidió**, y `verifiedBy` se escribía también al rechazar — o sea que
 * «quién verificó» acababa nombrando a quien había dicho que NO.
 */

/** Fila que devuelve el `upsert` (ya proyectada por `ADMIN_KYC_SELECT`). */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'kyc-1',
    userId: 'u1',
    kycStatus: KycStatus.pending,
    capPerRequestCentsOverride: null,
    capPerMonthCentsOverride: null,
    verifiedBy: null,
    verifiedAt: null,
    rejectionReason: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-09-11T00:00:00Z'),
    ineFrontKey: 'kyc_ine/f.png',
    ineBackKey: 'kyc_ine/b.png',
    ...over,
  };
}

function buildService(returned = row()) {
  const upsert = jest.fn().mockResolvedValue(returned);
  const svc = new AdminService(
    { kycProfile: { upsert } } as unknown as PrismaService,
    {} as PricingService,
    {} as PiiCryptoService,
    {} as UploadsService,
  );
  return { svc, upsert };
}

/** Lo que se ESCRIBE (la rama `update` del upsert es la que importa: el perfil ya existe). */
function written(upsert: jest.Mock) {
  return upsert.mock.calls[0][0].update as Record<string, unknown>;
}

describe('K-5 · el motivo es obligatorio SI Y SOLO SI se rechaza', () => {
  it.each([[undefined], [''], ['   ']])(
    'rechazar con motivo ausente/vacío (%p) ⇒ 422 KYC_REJECTION_REASON_REQUIRED',
    async (reason) => {
      const { svc, upsert } = buildService();
      await expect(
        svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin-1', reason),
      ).rejects.toMatchObject({
        code: 'KYC_REJECTION_REASON_REQUIRED',
        details: { field: 'rejectionReason' },
      });
      // ⛔ Y NO se escribe nada: un rechazo a medias dejaría al cliente en «rechazada» sin motivo.
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['dos caracteres', 'no'],
    ['501 caracteres', 'x'.repeat(501)],
  ])('fuera del rango 3–500 (%s) ⇒ 422 VALIDATION_ERROR con min/max', async (_n, reason) => {
    const { svc } = buildService();
    await expect(
      svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin-1', reason),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'rejectionReason', min: 3, max: 500 },
    });
  });

  it('los bordes SÍ entran: 3 y 500 exactos (mismo rango que `SellRequestItem.rejectionReason`)', async () => {
    for (const reason of ['abc', 'y'.repeat(500)]) {
      const { svc, upsert } = buildService(row({ kycStatus: KycStatus.rejected, rejectionReason: reason }));
      await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin-1', reason);
      expect(written(upsert).rejectionReason).toBe(reason);
    }
  });

  it('el rango se mide TRAS `trim()`, y lo que se PERSISTE es el valor recortado', async () => {
    const { svc, upsert } = buildService();
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin-1', '   La foto está borrosa.   ');
    expect(written(upsert).rejectionReason).toBe('La foto está borrosa.');
  });

  it.each([['verified'], ['none'], ['pending']])(
    '⛔ motivo SIN rechazar (kycStatus=%s) ⇒ 422 VALIDATION_ERROR — no se ignora en silencio',
    async (status) => {
      const { svc, upsert } = buildService();
      await expect(
        svc.updateUserKyc('u1', status, undefined, undefined, 'admin-1', 'un motivo cualquiera'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'rejectionReason' } });
      expect(upsert).not.toHaveBeenCalled();
    },
  );
});

describe('§M6-K.4 — qué se ESCRIBE en cada decisión (M-54)', () => {
  it('rechazar: motivo + `reviewedAt`/`reviewedBy`, y `verifiedAt` a NULL (dejó de estar verificado)', async () => {
    const { svc, upsert } = buildService(row({ kycStatus: KycStatus.rejected, rejectionReason: 'La INE está vencida.' }));
    await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'admin-7', 'La INE está vencida.');
    const data = written(upsert);
    expect(data.rejectionReason).toBe('La INE está vencida.');
    expect(data.reviewedBy).toBe('admin-7');
    expect(data.reviewedAt).toBeInstanceOf(Date);
    expect(data.verifiedAt).toBeNull();
    // ⭐ `verifiedBy` NO se escribe al rechazar: antes se escribía SIEMPRE y la columna «quién
    // verificó» acababa nombrando a quien rechazó.
    expect(data).not.toHaveProperty('verifiedBy');
  });

  it('verificar: sella `verifiedAt`/`verifiedBy` **y** limpia el motivo de un rechazo anterior', async () => {
    const { svc, upsert } = buildService(row({ kycStatus: KycStatus.verified }));
    await svc.updateUserKyc('u1', 'verified', undefined, undefined, 'admin-7');
    const data = written(upsert);
    expect(data.verifiedBy).toBe('admin-7');
    expect(data.verifiedAt).toBeInstanceOf(Date);
    expect(data.rejectionReason).toBeNull();
    expect(data.reviewedBy).toBe('admin-7');
  });

  it('`none` (deshacer una decisión tomada por error): limpia el motivo y ⛔ NO toca las imágenes', async () => {
    const { svc, upsert } = buildService(row({ kycStatus: KycStatus.none }));
    await svc.updateUserKyc('u1', 'none', undefined, undefined, 'admin-7');
    const data = written(upsert);
    expect(data.rejectionReason).toBeNull();
    // ⛔ K.4: el rechazo (ni deshacerlo) borra imágenes — son la evidencia de la decisión.
    expect(data).not.toHaveProperty('ineFrontKey');
    expect(data).not.toHaveProperty('ineBackKey');
  });

  it('§M6-K.7 · el DTO emite `rejectionReason` SOLO en `rejected` (nunca el residual)', async () => {
    const rejected = buildService(row({ kycStatus: KycStatus.rejected, rejectionReason: 'Foto borrosa.' }));
    const res1 = await rejected.svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'a', 'Foto borrosa.');
    expect(res1.rejectionReason).toBe('Foto borrosa.');

    // La MISMA fila, pero ya verificada y con el motivo viejo AÚN en la columna (caso residual).
    const verified = buildService(row({ kycStatus: KycStatus.verified, rejectionReason: 'Foto borrosa.' }));
    const res2 = await verified.svc.updateUserKyc('u1', 'verified', undefined, undefined, 'a');
    expect(res2).not.toHaveProperty('rejectionReason');
    expect(JSON.stringify(res2)).not.toContain('Foto borrosa.');
  });

  it('⛔ el DTO sigue sin llevar PII cifrada ni object keys (la lista blanca no se ensanchó)', async () => {
    const { svc } = buildService(row({ kycStatus: KycStatus.rejected, rejectionReason: 'abc' }));
    const res = await svc.updateUserKyc('u1', 'rejected', undefined, undefined, 'a', 'abc');
    for (const forbidden of ['rfcEnc', 'clabeEnc', 'clabeHmac', 'ineFrontKey', 'ineBackKey', 'legalName']) {
      expect(res).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(res)).not.toContain('kyc_ine/');
    expect(res.ineOnFile).toBe(true);
  });
});

describe('§M6-K.4 — la auditoría `user.kyc.update` lleva el motivo en `after`', () => {
  function buildController(returned: ReturnType<typeof row>) {
    const create: jest.Mock = jest.fn(async (_a: { data: Record<string, unknown> }) => ({}));
    const { svc } = buildService(returned);
    const audit = new AuditService({ auditLog: { create } } as unknown as PrismaService);
    return { ctrl: new AdminUsersController(svc, audit), create };
  }
  const actor = { id: 'admin-1', role: Role.super_admin };

  it('rechazo ⇒ `after = { kycStatus, rejectionReason }` con el motivo NORMALIZADO', async () => {
    const { ctrl, create } = buildController(
      row({ kycStatus: KycStatus.rejected, rejectionReason: 'No se lee el reverso.' }),
    );
    await ctrl.updateKyc('u1', { kycStatus: 'rejected', rejectionReason: '  No se lee el reverso.  ' }, actor);
    const data = (create.mock.calls[0][0] as { data: { after: Record<string, unknown> } }).data;
    expect(data.after).toEqual({ kycStatus: 'rejected', rejectionReason: 'No se lee el reverso.' });
  });

  it('verificación ⇒ `after` SIN `rejectionReason` (no se audita un motivo que no existe)', async () => {
    const { ctrl, create } = buildController(row({ kycStatus: KycStatus.verified }));
    await ctrl.updateKyc('u1', { kycStatus: 'verified' }, actor);
    const data = (create.mock.calls[0][0] as { data: { after: Record<string, unknown> } }).data;
    expect(data.after).toEqual({ kycStatus: 'verified' });
  });

  it('los topes se siguen auditando cuando el admin los toca (decisión comercial con nombre)', async () => {
    const { ctrl, create } = buildController(row({ kycStatus: KycStatus.verified }));
    await ctrl.updateKyc('u1', { kycStatus: 'verified', capPerMonthCents: 2_000_000 }, actor);
    const data = (create.mock.calls[0][0] as { data: { after: Record<string, unknown> } }).data;
    expect(data.after).toEqual({ kycStatus: 'verified', capPerMonthCents: 2_000_000 });
  });

  it('⛔ si el `PATCH` falla la validación, NO se audita nada (no hay decisión que registrar)', async () => {
    const { ctrl, create } = buildController(row());
    await expect(ctrl.updateKyc('u1', { kycStatus: 'rejected' }, actor)).rejects.toMatchObject({
      code: 'KYC_REJECTION_REASON_REQUIRED',
    });
    expect(create).not.toHaveBeenCalled();
  });
});

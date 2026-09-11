import { KycStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { UsersService } from '../src/modules/users/users.service';
import { UsersController } from '../src/modules/users/users.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * ⭐ **v1.69 (P-78, BK-3 y BK-4) — el lado del CLIENTE del ciclo de identidad.**
 * API_CONTRACT §1 (`GET`/`PUT /users/me/kyc`), §M6-K.5/K.6/K.7 — candados **K-6, K-7, K-8**.
 *
 * Los dos defectos que cierra, los dos medidos sobre v1.68.1:
 *  - **A6** (`users.service.ts:343-347`): **toda** llamada al `PUT` escribía `kycStatus:'pending'`,
 *    también una que solo traía `clabe` ⇒ **corregir la CLABE tiraba al suelo una verificación de
 *    identidad ya hecha**, que no tiene nada que ver con la CLABE.
 *  - **El objeto HUÉRFANO** (§M6-K.4.1): sustituir una key **abandonaba el objeto anterior** en el
 *    bucket, donde la purga de retención —que recorre las keys de `KycProfile`— **ya no lo alcanza**.
 */

const CLABE = '012345678901234567';
const pii = new PiiCryptoService(new ConfigService({}));

function buildService(existing: Record<string, unknown> | null, opts: { threshold?: number } = {}) {
  const state = { row: existing };
  const upsert = jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
    state.row = state.row ? { ...state.row, ...update } : { ...create };
    return state.row;
  });
  const prisma = {
    kycProfile: {
      // `findUnique` sirve a las DOS lecturas del flujo (la previa del `PUT` y la del `getKyc`).
      findUnique: jest.fn(async () => state.row),
      upsert,
    },
  };
  const settings = {
    getNumber: jest.fn().mockResolvedValue(opts.threshold ?? 300_000),
  } as unknown as SettingsService;
  const deleteObject: jest.Mock = jest.fn(async (_key: string) => undefined);
  const svc = new UsersService(
    prisma as unknown as PrismaService,
    settings,
    pii,
    { deleteObject } as unknown as UploadsService,
  );
  return { svc, prisma, upsert, deleteObject, settings, state };
}

describe('K-8 · ⛔ NINGÚN dial de política llega al cliente (§M6-K.5, decisión (c) del dueño)', () => {
  it('`GET /users/me/kyc` no trae umbral, ni topes, ni acumulado — con ningún nombre', async () => {
    const { svc } = buildService({ kycStatus: KycStatus.verified, clabeEnc: pii.encrypt(CLABE), ineFrontKey: 'f', ineBackKey: 'b' });
    const res = await svc.getKyc('u1');
    for (const prohibido of [
      'capPerRequestCents',
      'capPerMonthCents',
      'monthUsedCents',
      'ineThresholdCents',
      'thresholdCents',
    ]) {
      expect(res).not.toHaveProperty(prohibido);
    }
    // La forma queda CERRADA: cinco claves y ni una más (un campo nuevo se ve aquí).
    expect(Object.keys(res).sort()).toEqual(['clabeMasked', 'clabeOnFile', 'ineOnFile', 'kycStatus']
      .concat([])
      .sort());
  });

  it('sin `?quotedTotalCents` NI SIQUIERA se lee el umbral de `Setting` (no hay nada que comparar)', async () => {
    const { svc, settings } = buildService(null);
    await svc.getKyc('u1');
    expect((settings.getNumber as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('§M6-K.5 · `?quotedTotalCents=N` ⇒ `ineRequiredForTotal`: un VEREDICTO, no un dial', () => {
  it.each([
    ['por debajo del umbral', 299_999, false],
    ['justo en el umbral (borde INCLUSIVO, igual que el intake)', 300_000, true],
    ['por encima', 900_000, true],
  ])('%s ⇒ %p', async (_n, total, expected) => {
    const { svc } = buildService(null, { threshold: 300_000 });
    const res = await svc.getKyc('u1', total);
    expect(res.ineRequiredForTotal).toBe(expected);
  });

  it('⛔ el umbral NO se revela en ninguna forma junto al veredicto', async () => {
    const { svc } = buildService(null, { threshold: 300_000 });
    const res = await svc.getKyc('u1', 900_000);
    expect(JSON.stringify(res)).not.toContain('300000');
  });

  it('el controller rechaza un `quotedTotalCents` no entero o negativo con 422 + `details.field`', async () => {
    const { svc } = buildService(null);
    const ctrl = new UsersController(svc);
    for (const raw of ['abc', '-1', '12.5', '', ' 12 ', '1e3', '99999999999999999999']) {
      expect(() => ctrl.getKyc('u1', raw)).toThrow();
      try {
        ctrl.getKyc('u1', raw);
      } catch (e) {
        expect(e).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'quotedTotalCents' } });
      }
    }
    // …y `0` es válido (un carrito vacío no necesita INE, y decirlo es una respuesta legítima).
    await expect(ctrl.getKyc('u1', '0')).resolves.toMatchObject({ ineRequiredForTotal: false });
  });
});

describe('K-6 · el motivo del rechazo LE LLEGA AL CLIENTE (decisión (b) del dueño)', () => {
  it('`rejected` ⇒ `rejectionReason` exacto, tal cual lo escribió el `super_admin`', async () => {
    const { svc } = buildService({
      kycStatus: KycStatus.rejected,
      rejectionReason: 'No se alcanza a leer: la foto está borrosa.',
      ineFrontKey: 'f',
      ineBackKey: 'b',
    });
    const res = await svc.getKyc('u1');
    expect(res.rejectionReason).toBe('No se alcanza a leer: la foto está borrosa.');
    expect(res.kycStatus).toBe(KycStatus.rejected);
    expect(res.ineOnFile).toBe(true);
  });

  it.each([[KycStatus.none], [KycStatus.pending], [KycStatus.verified]])(
    '⛔ en `%s` la clave NO viaja, ni siquiera con un motivo residual en la columna',
    async (status) => {
      const { svc } = buildService({ kycStatus: status, rejectionReason: 'motivo viejo', ineFrontKey: 'f', ineBackKey: 'b' });
      const res = await svc.getKyc('u1');
      expect(res).not.toHaveProperty('rejectionReason');
      expect(JSON.stringify(res)).not.toContain('motivo viejo');
    },
  );
});

describe('K-7 · el `PUT` mueve `kycStatus` SOLO si trae INE (defecto A6)', () => {
  it('⭐ partiendo de `verified`, un `PUT` SOLO con CLABE **NO** toca `kycStatus` ni el sello de revisión', async () => {
    const { svc, upsert } = buildService({
      kycStatus: KycStatus.verified,
      verifiedAt: new Date('2026-09-01T00:00:00Z'),
      verifiedBy: 'admin-1',
      ineFrontKey: 'f',
      ineBackKey: 'b',
    });
    const res = await svc.putKyc('u1', { clabe: CLABE });
    const update = upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('kycStatus');
    expect(update).not.toHaveProperty('rejectionReason');
    expect(update).not.toHaveProperty('reviewedAt');
    expect(Object.keys(update).sort()).toEqual(['clabeEnc', 'clabeHmac']);
    expect(res.kycStatus).toBe(KycStatus.verified);
  });

  it('partiendo de `rejected`, re-subir INE ⇒ `pending` y el motivo se LIMPIA en la columna', async () => {
    const { svc, upsert } = buildService({
      kycStatus: KycStatus.rejected,
      rejectionReason: 'La INE está vencida.',
      reviewedAt: new Date(),
      reviewedBy: 'admin-1',
      ineFrontKey: 'viejo-f',
      ineBackKey: 'viejo-b',
    });
    const res = await svc.putKyc('u1', { ineFrontUploadKey: 'nuevo-f', ineBackUploadKey: 'nuevo-b' });
    expect(upsert.mock.calls[0][0].update).toMatchObject({
      kycStatus: 'pending',
      rejectionReason: null,
      reviewedAt: null,
      reviewedBy: null,
    });
    expect(res.kycStatus).toBe('pending');
    // El motivo del rechazo no puede sobrevivir a la corrección que lo responde.
    expect(res).not.toHaveProperty('rejectionReason');
  });

  it('`verified` también es re-subible (foto vencida): una sola key basta para volver a `pending`', async () => {
    const { svc, upsert } = buildService({ kycStatus: KycStatus.verified, ineFrontKey: 'viejo-f', ineBackKey: 'b' });
    await svc.putKyc('u1', { ineFrontUploadKey: 'nuevo-f' });
    expect(upsert.mock.calls[0][0].update.kycStatus).toBe('pending');
  });

  it('creando el perfil SOLO con CLABE, el estado se queda en el default (`none`): una CLABE no es una identidad', async () => {
    const { svc, upsert } = buildService(null);
    await svc.putKyc('u1', { clabe: CLABE });
    expect(upsert.mock.calls[0][0].create).not.toHaveProperty('kycStatus');
  });
});

describe('§M6-K.4.1 · el objeto HUÉRFANO: sustituir una key BORRA la anterior en R2', () => {
  it('sustituir las dos keys ⇒ se borran las dos viejas, y DESPUÉS de persistir las nuevas', async () => {
    const { svc, deleteObject, upsert } = buildService({
      kycStatus: KycStatus.rejected,
      ineFrontKey: 'kyc_ine/viejo-f.png',
      ineBackKey: 'kyc_ine/viejo-b.png',
    });
    await svc.putKyc('u1', { ineFrontUploadKey: 'kyc_ine/nuevo-f.png', ineBackUploadKey: 'kyc_ine/nuevo-b.png' });
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['kyc_ine/viejo-f.png', 'kyc_ine/viejo-b.png']);
    // El orden importa: si se borrara ANTES y la escritura fallara, el cliente se queda sin INE.
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(deleteObject.mock.invocationCallOrder[0]);
  });

  it('⛔ NO se borra nada cuando la key entrante es LA MISMA (un re-`PUT` idéntico no destruye el INE)', async () => {
    const { svc, deleteObject } = buildService({ ineFrontKey: 'kyc_ine/f.png', ineBackKey: 'kyc_ine/b.png' });
    await svc.putKyc('u1', { ineFrontUploadKey: 'kyc_ine/f.png', ineBackUploadKey: 'kyc_ine/b.png' });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('⛔ NO se borra nada en la PRIMERA subida (no hay objeto anterior que huerfanar)', async () => {
    const { svc, deleteObject } = buildService(null);
    await svc.putKyc('u1', { ineFrontUploadKey: 'kyc_ine/f.png', ineBackUploadKey: 'kyc_ine/b.png' });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('solo se sustituye el FRENTE ⇒ el reverso intacto se queda donde está', async () => {
    const { svc, deleteObject } = buildService({ ineFrontKey: 'kyc_ine/viejo-f.png', ineBackKey: 'kyc_ine/b.png' });
    await svc.putKyc('u1', { ineFrontUploadKey: 'kyc_ine/nuevo-f.png' });
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['kyc_ine/viejo-f.png']);
  });

  it('si el borrado falla, la petición NO se cae: la subida ya está guardada y el cliente no puede hacer nada', async () => {
    const { svc, deleteObject } = buildService({ ineFrontKey: 'kyc_ine/viejo-f.png', ineBackKey: 'b' });
    (deleteObject as jest.Mock).mockRejectedValueOnce(new Error('R2 unavailable'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await expect(svc.putKyc('u1', { ineFrontUploadKey: 'kyc_ine/nuevo-f.png' })).resolves.toMatchObject({
        kycStatus: 'pending',
      });
      // Pero queda registrado: un huérfano silencioso es PII sin reloj que nadie sabe que existe.
      expect(errorSpy).toHaveBeenCalled();
      expect(String(errorSpy.mock.calls[0][0])).toContain('huérfana');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

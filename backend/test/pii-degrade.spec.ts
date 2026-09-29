import { ConfigService } from '@nestjs/config';
import { Role, KycStatus } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { UsersService } from '../src/modules/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * ⭐ Robustez PII (deuda M11) — **un campo PII que NO descifra DEGRADA, no tumba la pantalla.**
 *
 * `GET /admin/users/:id` y `GET /users/me/kyc` descifran CLABE/RFC cifrados en reposo para
 * enmascararlos. Si una fila fue escrita con OTRA clave (rotación de `PII_ENCRYPTION_KEY`, clave
 * efímera de un proceso anterior) o está corrupta, `decrypt` LANZA — y hoy ese throw sube sin
 * capturar hasta el filtro global ⇒ **500 que tumba toda la ficha / todo el KYC**.
 *
 * El contrato correcto es **aditivo**: el campo ilegible sale `undefined` (enmascarado a nada) y la
 * respuesta gana `piiUnavailable: true` **solo en ese estado degradado**; el resto viaja intacto y el
 * código sale **200**. En el camino feliz `piiUnavailable` NO existe (los candados de conjunto de
 * claves —R-1, K-8— siguen verdes).
 *
 * ANTES del arreglo estos tests están en ROJO: los `getUser`/`getKyc` LANZAN (⇒ 500), no resuelven.
 */

const CLABE = '012345678901234567';
const RFC = 'XAXX010101000';
// Un texto cifrado de la forma correcta (`v1:iv:tag:ct`) pero que NINGUNA clave de este proceso
// autentica: emula «clave rotada / fila corrupta». `decrypt` lanza sobre esto.
const UNDECRYPTABLE =
  'v1:' + Buffer.alloc(12).toString('base64') + ':' + Buffer.alloc(16).toString('base64') + ':' + Buffer.from('garbage').toString('base64');

describe('PII indescifrable — degrada a `piiUnavailable`, nunca 500', () => {
  const pii = new PiiCryptoService(new ConfigService({}));

  describe('AdminService.getUser (`GET /admin/users/:id`)', () => {
    function buildAdmin(kycOverrides: Record<string, unknown>, billingOverrides: Record<string, unknown> | null) {
      const prisma: any = {
        priceReference: { findMany: jest.fn().mockResolvedValue([]) },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'cliente@example.com',
            name: 'Cliente',
            nameSource: 'user',
            role: 'customer',
            status: 'active',
            locale: 'es',
            emailVerified: true,
            authProvider: 'local',
            phone: '5511110000',
            avatarUrl: null,
            mustChangePassword: false,
            deletedAt: null,
            anonymizedAt: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-02T00:00:00Z'),
            kycProfile: {
              id: 'k1',
              userId: 'u1',
              kycStatus: 'verified',
              capPerMonthCentsOverride: null,
              verifiedBy: 'admin-1',
              verifiedAt: new Date('2026-02-01T00:00:00Z'),
              reviewedAt: new Date('2026-02-01T00:00:00Z'),
              reviewedBy: 'admin-1',
              rejectionReason: null,
              ineFrontKey: 'kyc_ine/2026/front.jpg',
              ineBackKey: 'kyc_ine/2026/back.jpg',
              createdAt: new Date('2026-01-01T00:00:00Z'),
              updatedAt: new Date('2026-02-01T00:00:00Z'),
              ...kycOverrides,
            },
            billingProfile:
              billingOverrides === null
                ? null
                : {
                    id: 'b1',
                    userId: 'u1',
                    razonSocial: 'ACME SA de CV',
                    regimenFiscal: '601',
                    usoCfdi: 'G03',
                    postalCode: '06700',
                    email: 'facturas@example.com',
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    updatedAt: new Date('2026-01-01T00:00:00Z'),
                    ...billingOverrides,
                  },
            addresses: [],
            orders: [],
            sellRequests: [],
            disputes: [],
            shipmentRequests: [],
            ownedItems: [],
          }),
        },
      };
      const pricing = { fxSnapshotSafe: jest.fn().mockResolvedValue(null) } as unknown as PricingService;
      return new AdminService(prisma as PrismaService, pricing, pii, {} as UploadsService);
    }

    it('super_admin: CLABE indescifrable ⇒ 200, `clabeMasked` undefined, `kycProfile.piiUnavailable` true, resto intacto', async () => {
      const svc = buildAdmin(
        { clabeEnc: UNDECRYPTABLE, rfcEnc: pii.encrypt(RFC) },
        { rfcEnc: pii.encrypt(RFC) },
      );
      const res: any = await svc.getUser('u1', Role.super_admin);
      // El campo se degrada, no revienta.
      expect(res.kycProfile.clabeMasked).toBeUndefined();
      expect(res.kycProfile.piiUnavailable).toBe(true);
      // El RFC del KYC SÍ descifra ⇒ sigue enmascarado y presente.
      expect(res.kycProfile.rfcMasked).toBe('XAX**********');
      // El resto de la ficha viaja intacto.
      expect(res.kycProfile.kycStatus).toBe('verified');
      expect(res.kycProfile.ineOnFile).toBe(true);
      expect(res.email).toBe('cliente@example.com');
      // El billing (RFC bueno) NO se marca degradado.
      expect(res.billingProfile.rfcMasked).toBe('XAX**********');
      expect(res.billingProfile.piiUnavailable).toBeUndefined();
      // Jamás el texto cifrado ni la CLABE en claro.
      expect(JSON.stringify(res)).not.toContain(CLABE);
      expect(JSON.stringify(res)).not.toContain(UNDECRYPTABLE);
    });

    it('super_admin: RFC de billing indescifrable ⇒ `billingProfile.piiUnavailable` true, KYC intacto', async () => {
      const svc = buildAdmin(
        { clabeEnc: pii.encrypt(CLABE), rfcEnc: pii.encrypt(RFC) },
        { rfcEnc: UNDECRYPTABLE },
      );
      const res: any = await svc.getUser('u1', Role.super_admin);
      expect(res.billingProfile.rfcMasked).toBeUndefined();
      expect(res.billingProfile.piiUnavailable).toBe(true);
      // El KYC descifra bien ⇒ sin flag y con enmascarados.
      expect(res.kycProfile.clabeMasked).toBe('**************4567');
      expect(res.kycProfile.rfcMasked).toBe('XAX**********');
      expect(res.kycProfile.piiUnavailable).toBeUndefined();
    });

    it('vault_operator: CLABE indescifrable ⇒ 200 con `kycProfile.piiUnavailable` true', async () => {
      const svc = buildAdmin({ clabeEnc: UNDECRYPTABLE }, null);
      const res: any = await svc.getUser('u1', Role.vault_operator);
      expect(res.kycProfile.clabeMasked).toBeUndefined();
      expect(res.kycProfile.piiUnavailable).toBe(true);
      expect(res.kycProfile.kycStatus).toBe('verified');
    });

    it('CAMINO FELIZ: CLABE/RFC descifran ⇒ NINGÚN `piiUnavailable` (contrato aditivo, no altera la forma)', async () => {
      const svc = buildAdmin(
        { clabeEnc: pii.encrypt(CLABE), rfcEnc: pii.encrypt(RFC) },
        { rfcEnc: pii.encrypt(RFC) },
      );
      const res: any = await svc.getUser('u1', Role.super_admin);
      expect(res.kycProfile.clabeMasked).toBe('**************4567');
      expect(res.kycProfile).not.toHaveProperty('piiUnavailable');
      expect(res.billingProfile).not.toHaveProperty('piiUnavailable');
    });
  });

  describe('UsersService.getKyc (`GET /users/me/kyc`)', () => {
    function buildUsers(row: Record<string, unknown> | null) {
      const prisma = {
        kycProfile: { findUnique: jest.fn(async () => row) },
      };
      const settings = { getNumber: jest.fn().mockResolvedValue(300_000) } as unknown as SettingsService;
      return new UsersService(
        prisma as unknown as PrismaService,
        settings,
        pii,
        { deleteObject: jest.fn(), assertOwnedIneKeys: jest.fn() } as unknown as UploadsService,
      );
    }

    it('CLABE indescifrable ⇒ 200, `clabeMasked` undefined, `piiUnavailable` true, `clabeOnFile` sigue true', async () => {
      const svc = buildUsers({
        kycStatus: KycStatus.verified,
        clabeEnc: UNDECRYPTABLE,
        ineFrontKey: 'f',
        ineBackKey: 'b',
      });
      const res: any = await svc.getKyc('u1');
      expect(res.clabeMasked).toBeUndefined();
      expect(res.piiUnavailable).toBe(true);
      // Hay una CLABE en la fila (cifrada); no poder leerla NO la borra: `clabeOnFile` sigue true.
      expect(res.clabeOnFile).toBe(true);
      expect(res.ineOnFile).toBe(true);
      expect(res.kycStatus).toBe('verified');
      expect(JSON.stringify(res)).not.toContain(UNDECRYPTABLE);
    });

    it('CAMINO FELIZ: CLABE descifra ⇒ sin `piiUnavailable`, forma cerrada intacta', async () => {
      const svc = buildUsers({
        kycStatus: KycStatus.verified,
        clabeEnc: pii.encrypt(CLABE),
        ineFrontKey: 'f',
        ineBackKey: 'b',
      });
      const res: any = await svc.getKyc('u1');
      expect(res.clabeMasked).toBe('**************4567');
      expect(res).not.toHaveProperty('piiUnavailable');
      expect(Object.keys(res).sort()).toEqual(['clabeMasked', 'clabeOnFile', 'ineOnFile', 'kycStatus'].sort());
    });
  });
});

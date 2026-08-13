import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * SEC-A4: segregación de funciones. El `vault_operator` NO debe ver PII bancaria/fiscal/
 * identidad (CLABE/RFC/INE). Recibe una ficha reducida; el `super_admin`, la completa.
 */
describe('AdminService.getUser — SEC-A4 proyección de PII por rol', () => {
  function buildService() {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'cliente@example.com',
          name: 'Cliente',
          role: 'customer',
          passwordHash: 'HASH',
          kycProfile: {
            id: 'k1',
            userId: 'u1',
            legalName: 'Cliente Legal',
            rfc: 'XAXX010101000',
            clabe: '012345678901234567',
            ineFrontKey: 'kyc_ine/2026/front.jpg',
            ineBackKey: 'kyc_ine/2026/back.jpg',
            kycStatus: 'verified',
            capPerRequestCentsOverride: null,
            capPerMonthCentsOverride: null,
            verifiedAt: new Date(),
          },
          billingProfile: { id: 'b1', userId: 'u1', rfc: 'XAXX010101000', razonSocial: 'ACME' },
          addresses: [],
          orders: [],
          sellRequests: [],
          disputes: [],
          ownedItems: [],
        }),
      },
    };
    return { prisma, service: new AdminService(prisma as PrismaService, {} as PricingService) };
  }

  it('vault_operator: sin CLABE completa (enmascarada), sin RFC ni INE keys, sin billingProfile', async () => {
    const { service } = buildService();
    const res: any = await service.getUser('u1', Role.vault_operator);

    // CLABE enmascarada (solo últimos 4).
    expect(res.kycProfile.clabe).toBe('**************4567');
    expect(res.kycProfile.clabe).not.toContain('012345678901');
    // INE nunca como keys; solo un booleano de presencia.
    expect(res.kycProfile.ineFrontKey).toBeUndefined();
    expect(res.kycProfile.ineBackKey).toBeUndefined();
    expect(res.kycProfile.ineOnFile).toBe(true);
    // RFC (KYC y billing) oculto.
    expect(res.kycProfile.rfc).toBeUndefined();
    expect(res.billingProfile).toBeNull();
    // Nunca el hash de password.
    expect(res.passwordHash).toBeUndefined();
    // Sigue siendo una ficha útil (estado KYC, límites).
    expect(res.kycProfile.kycStatus).toBe('verified');
  });

  it('super_admin: recibe la ficha completa (CLABE, RFC, INE keys, billingProfile)', async () => {
    const { service } = buildService();
    const res: any = await service.getUser('u1', Role.super_admin);

    expect(res.kycProfile.clabe).toBe('012345678901234567');
    expect(res.kycProfile.ineFrontKey).toBe('kyc_ine/2026/front.jpg');
    expect(res.kycProfile.rfc).toBe('XAXX010101000');
    expect(res.billingProfile).toMatchObject({ rfc: 'XAXX010101000' });
    expect(res.passwordHash).toBeUndefined();
  });
});

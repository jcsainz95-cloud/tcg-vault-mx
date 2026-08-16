import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { maskRfc } from '../src/common/crypto/pii-mask';

/**
 * SEC-A4 + endurecimiento PII: la CLABE/RFC viven CIFRADOS en reposo y en la ficha 360°
 * se devuelven SIEMPRE enmascarados (nunca en claro), incluso para `super_admin`. El
 * `vault_operator` recibe una ficha aún más reducida (sin RFC ni INE keys, sin billing).
 */
describe('AdminService.getUser — PII cifrada + enmascarado por rol', () => {
  const pii = new PiiCryptoService(new ConfigService({}));
  const CLABE = '012345678901234567';
  const RFC = 'XAXX010101000';

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
            rfcEnc: pii.encrypt(RFC),
            clabeEnc: pii.encrypt(CLABE),
            clabeHmac: pii.clabeBlindIndex(CLABE),
            ineFrontKey: 'kyc_ine/2026/front.jpg',
            ineBackKey: 'kyc_ine/2026/back.jpg',
            kycStatus: 'verified',
            capPerRequestCentsOverride: null,
            capPerMonthCentsOverride: null,
            verifiedAt: new Date(),
          },
          billingProfile: { id: 'b1', userId: 'u1', rfcEnc: pii.encrypt(RFC), razonSocial: 'ACME' },
          addresses: [],
          orders: [],
          sellRequests: [],
          disputes: [],
          ownedItems: [
            {
              // Fila cruda de InventoryItem tal cual la trae Prisma (con la relación `card` + `set`).
              id: 'inv1',
              folio: 'F-000123',
              status: 'stored',
              ownershipStatus: 'owned',
              cardId: 'c1',
              productType: 'raw',
              finish: 'normal',
              card: {
                id: 'c1',
                externalId: 'base1-4',
                name: 'Charizard',
                number: '4',
                rarity: 'Rare Holo',
                supertype: 'Pokémon',
                subtypes: ['Stage 2'],
                setId: 's1',
                imageSmallUrl: 'https://img/small.png',
                imageLargeUrl: 'https://img/large.png',
                availableFinishes: ['normal', 'holofoil'],
                set: { id: 's1', name: 'Base' },
              },
            },
          ],
        }),
      },
    };
    return {
      prisma,
      service: new AdminService(prisma as PrismaService, {} as PricingService, pii, {} as any),
    };
  }

  it('vault_operator: CLABE enmascarada, sin RFC ni INE keys, sin billingProfile', async () => {
    const { service } = buildService();
    const res: any = await service.getUser('u1', Role.vault_operator);

    expect(res.kycProfile.clabeMasked).toBe('**************4567');
    expect(res.kycProfile.clabeMasked).not.toContain('012345678901');
    // Nombres de campo del contrato §M6: enmascarados como *Masked; el campo plano
    // `clabe` no existe.
    expect(res.kycProfile.clabe).toBeUndefined();
    // Topes con el nombre del contrato (no *Override).
    expect(res.kycProfile).toHaveProperty('capPerRequestCents');
    expect(res.kycProfile).toHaveProperty('capPerMonthCents');
    expect(res.kycProfile.capPerRequestCentsOverride).toBeUndefined();
    expect(res.kycProfile.capPerMonthCentsOverride).toBeUndefined();
    // Nunca la CLABE cifrada ni el blind index.
    expect(res.kycProfile.clabeEnc).toBeUndefined();
    expect(res.kycProfile.clabeHmac).toBeUndefined();
    // INE nunca como keys; solo un booleano de presencia.
    expect(res.kycProfile.ineFrontKey).toBeUndefined();
    expect(res.kycProfile.ineBackKey).toBeUndefined();
    expect(res.kycProfile.ineOnFile).toBe(true);
    // RFC (KYC y billing) oculto.
    expect(res.kycProfile.rfcMasked).toBeUndefined();
    expect(res.kycProfile.rfc).toBeUndefined();
    expect(res.billingProfile).toBeNull();
    expect(res.passwordHash).toBeUndefined();
    expect(res.kycProfile.kycStatus).toBe('verified');
  });

  it('super_admin: CLABE y RFC ENMASCARADOS (nunca en claro), sin cifrado crudo', async () => {
    const { service } = buildService();
    const res: any = await service.getUser('u1', Role.super_admin);

    // CLABE/RFC enmascarados (nombres del contrato §M6): reveal en claro solo por endpoint dedicado.
    expect(res.kycProfile.clabeMasked).toBe('**************4567');
    expect(res.kycProfile.rfcMasked).toBe(maskRfc(RFC));
    expect(res.kycProfile.rfcMasked).not.toBe(RFC);
    // Los nombres planos `clabe`/`rfc` no existen en el DTO.
    expect(res.kycProfile.clabe).toBeUndefined();
    expect(res.kycProfile.rfc).toBeUndefined();
    // El texto cifrado y el blind index no se filtran.
    expect(res.kycProfile.clabeEnc).toBeUndefined();
    expect(res.kycProfile.rfcEnc).toBeUndefined();
    expect(res.kycProfile.clabeHmac).toBeUndefined();
    // INE keys visibles al super_admin (para servir la imagen por presigned GET).
    expect(res.kycProfile.ineFrontKey).toBe('kyc_ine/2026/front.jpg');
    // Billing con RFC enmascarado (rfcMasked), sin rfcEnc crudo ni `rfc` plano.
    expect(res.billingProfile.rfcMasked).toBe(maskRfc(RFC));
    expect(res.billingProfile.rfc).toBeUndefined();
    expect(res.billingProfile.rfcEnc).toBeUndefined();
    expect(res.passwordHash).toBeUndefined();
    // En ninguna proyección aparece la CLABE en claro.
    expect(JSON.stringify(res)).not.toContain(CLABE);
    expect(JSON.stringify(res)).not.toContain(RFC);
  });

  // Regresión v1.7-admin-users: `ownedItems` DEBE conformar el contrato §M6
  // `AdminUserOwnedItemRef = { inventoryItemId, folio, card: CardDTO, ownershipStatus }`.
  // Antes proyectaba `id`/`status` crudos y sin `card` → la pestaña Bóveda (M6View)
  // crasheaba contra el backend real (`i.card.name` undefined, `rowKey` undefined).
  it.each([Role.super_admin, Role.vault_operator])(
    'ownedItems conforma AdminUserOwnedItemRef (inventoryItemId + card, no id crudo) — %s',
    async (role) => {
      const { service } = buildService();
      const res: any = await service.getUser('u1', role);

      expect(Array.isArray(res.ownedItems)).toBe(true);
      const item = res.ownedItems[0];
      // Clave del contrato: inventoryItemId (derivado del InventoryItem.id), no `id` crudo.
      expect(item.inventoryItemId).toBe('inv1');
      expect(item.id).toBeUndefined();
      // `status` crudo del InventoryItem no forma parte del ref del contrato.
      expect(item.status).toBeUndefined();
      // La carta viene mapeada como CardDTO (mismo shape que catalog/buylist/vault).
      expect(item.card).toBeDefined();
      expect(item.card.id).toBe('c1');
      expect(item.card.name).toBe('Charizard');
      expect(item.card.availableFinishes).toEqual(['normal', 'holofoil']);
      expect(item.folio).toBe('F-000123');
      expect(item.ownershipStatus).toBe('owned');
    },
  );
});

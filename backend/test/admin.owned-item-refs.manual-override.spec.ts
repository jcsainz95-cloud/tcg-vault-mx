import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * §4.27f-2 (P47-2, v1.46) — la ficha 360° admin (`ownedItemRefs`) usa `isBetterRef`, NO «la primera
 * vista» del orden `capturedDate desc`. Con un override manual DURABLE viejo + una automática fresca para
 * la misma clave, la vista admin DEBE mostrar el precio manual (paridad con `getReference`), no la
 * automática fresca. `ownedItemRefs` lee sin `take`, así que la manual siempre está presente: el fix es
 * reducir con la MISMA precedencia que el resto de consumidores.
 */
describe('AdminService.ownedItemRefs — override manual durable gana a la automática fresca (P47-2)', () => {
  const pii = new PiiCryptoService(new ConfigService({}));
  const MANUAL_PRICE = 9900;
  const AUTO_PRICE = 1234;

  function priceRef(over: Partial<any>): any {
    return {
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      priceMxnCents: 0,
      priceUsdCents: null,
      isManualOverride: false,
      source: 'tcgcsv_singles',
      capturedDate: new Date('2026-08-22T00:00:00Z'),
      createdAt: new Date('2026-08-22T00:00:00Z'),
      cardProductId: null,
      ...over,
    };
  }

  function buildService(priceRefs: any[]) {
    const prisma: any = {
      priceReference: { findMany: jest.fn().mockResolvedValue(priceRefs) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'cliente@example.com',
          name: 'Cliente',
          role: 'customer',
          passwordHash: 'HASH',
          kycProfile: null,
          billingProfile: null,
          addresses: [],
          orders: [],
          sellRequests: [],
          disputes: [],
          ownedItems: [
            {
              id: 'inv1',
              folio: 'F-000123',
              status: 'stored',
              ownershipStatus: 'owned',
              cardId: 'c1',
              productType: 'raw',
              finish: 'normal',
              rawCondition: 'NM',
              gradingCompany: null,
              gradeValue: null,
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
                availableFinishes: ['normal'],
                set: { id: 's1', name: 'Base' },
              },
            },
          ],
        }),
      },
    };
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      fxSnapshotSafe: jest.fn().mockResolvedValue(null),
      liveMxnCents: (ref: { priceMxnCents: number }) => ref.priceMxnCents,
    } as unknown as PricingService;
    return new AdminService(prisma as PrismaService, pricing, pii, {} as never);
  }

  it('muestra el precio MANUAL viejo, no la automática fresca (aunque la automática sea más reciente)', async () => {
    // Automática FRESCA (más reciente) vs override MANUAL viejo. «La primera vista» del orden desc daría
    // la automática; `isBetterRef` (tier manual absoluto) da el manual.
    const refs = [
      priceRef({
        isManualOverride: false,
        source: 'tcgcsv_singles',
        priceMxnCents: AUTO_PRICE,
        capturedDate: new Date('2026-08-22T00:00:00Z'),
        createdAt: new Date('2026-08-22T00:00:00Z'),
      }),
      priceRef({
        isManualOverride: true,
        source: 'manual',
        priceMxnCents: MANUAL_PRICE,
        capturedDate: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ];
    const service = buildService(refs);
    const res: any = await service.getUser('u1', Role.super_admin);
    const item = res.ownedItems[0];
    expect(item.referenceValue.status).toBe('priced');
    expect(item.referenceValue.referenceMxnCents).toBe(MANUAL_PRICE);
    expect(item.referenceValue.source).toBe('manual');
  });

  it('sin override manual, muestra la automática MÁS FRESCA (sin regresión)', async () => {
    const refs = [
      priceRef({
        source: 'tcgcsv_singles',
        priceMxnCents: 500,
        capturedDate: new Date('2026-08-20T00:00:00Z'),
        createdAt: new Date('2026-08-20T00:00:00Z'),
      }),
      priceRef({
        source: 'tcgcsv_singles',
        priceMxnCents: AUTO_PRICE,
        capturedDate: new Date('2026-08-22T00:00:00Z'),
        createdAt: new Date('2026-08-22T00:00:00Z'),
      }),
    ];
    const service = buildService(refs);
    const res: any = await service.getUser('u1', Role.super_admin);
    expect(res.ownedItems[0].referenceValue.referenceMxnCents).toBe(AUTO_PRICE);
  });
});
